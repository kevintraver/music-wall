import WebSocket, { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';

const TOKEN_FILE = path.join(process.cwd(), 'data', 'spotify-tokens.json');

// OAuth variables
let accessToken = '';
let refreshToken = '';

// Token persistence
function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      accessToken = tokens.accessToken || '';
      refreshToken = tokens.refreshToken || '';
      return true;
    }
  } catch (error) {
    console.error('Error loading saved tokens:', error);
  }
  return false;
}

function saveTokens() {
  try {
    const tokens = {
      accessToken,
      refreshToken,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    console.log('Saved Spotify tokens to file');
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}



// Load saved tokens
loadTokens();

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: 'http://127.0.0.1:3000/callback'
});

// Set access token if loaded
if (accessToken) {
  spotifyApi.setAccessToken(accessToken);
}

// Refresh token function
async function refreshAccessToken() {
  if (!refreshToken) return;
  try {
    console.log('Refreshing Spotify access token...');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID!,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    const data = await response.json();
    if (data.access_token) {
      accessToken = data.access_token;
      if (data.refresh_token) {
        refreshToken = data.refresh_token;
      }
      spotifyApi.setAccessToken(accessToken);
      saveTokens();
      console.log('Successfully refreshed and saved Spotify tokens');
    } else {
      console.error('Failed to refresh token:', data);
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
  }
}

// WebSocket server
const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3002;

export function startWebSocketServer() {
  const wss = new WebSocketServer({ port: WS_PORT });
  console.log('WebSocket server listening on port', WS_PORT);

  const clients: WebSocket[] = [];

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');
    clients.push(ws);
    ws.on('close', () => {
      console.log('Client disconnected');
      const index = clients.indexOf(ws);
      if (index !== -1) {
        clients.splice(index, 1);
      }
    });
  });

  function sendUpdate(data: any) {
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

// Rate limiting and circuit breaker for polling
let lastApiCall = 0;
const MIN_API_INTERVAL = 5000;
let consecutiveErrors = 0;

let circuitBreakerState = 'CLOSED';
let circuitBreakerFailures = 0;
let circuitBreakerLastFailure = 0;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000;

function checkCircuitBreaker() {
  const now = Date.now();

  if (circuitBreakerState === 'OPEN') {
    if (now - circuitBreakerLastFailure > CIRCUIT_BREAKER_TIMEOUT) {
      console.log('Circuit breaker transitioning to HALF_OPEN');
      circuitBreakerState = 'HALF_OPEN';
      return true;
    }
    return false;
  }

  return true;
}

function recordCircuitBreakerResult(success: boolean) {
  if (success) {
    if (circuitBreakerState === 'HALF_OPEN') {
      console.log('Circuit breaker transitioning to CLOSED');
      circuitBreakerState = 'CLOSED';
      circuitBreakerFailures = 0;
    }
  } else {
    circuitBreakerFailures++;
    circuitBreakerLastFailure = Date.now();

    if (circuitBreakerFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      console.log('Circuit breaker transitioning to OPEN');
      circuitBreakerState = 'OPEN';
    }
  }
}

// Endpoint-specific rate limiting
const endpointLimits = {
  'getMyCurrentPlayingTrack': { calls: 0, windowStart: Date.now(), limit: 3, window: 3000 },
  'getMyCurrentPlaybackState': { calls: 0, windowStart: Date.now(), limit: 3, window: 3000 },
};

function checkEndpointRateLimit(endpoint: string) {
  const now = Date.now();
  const limit = endpointLimits[endpoint as keyof typeof endpointLimits];

  if (!limit) return true;

  if (now - limit.windowStart >= limit.window) {
    limit.calls = 0;
    limit.windowStart = now;
  }

  if (limit.calls >= limit.limit) {
    const waitTime = limit.window - (now - limit.windowStart);
    console.log(`Endpoint ${endpoint} rate limited: ${limit.calls}/${limit.limit} calls in window, wait ${waitTime}ms`);
    return waitTime;
  }

  return true;
}

function recordEndpointCall(endpoint: string) {
  const limit = endpointLimits[endpoint as keyof typeof endpointLimits];
  if (limit) {
    limit.calls++;
  }
}

function getRetryAfterDelay(error: any) {
  if (error.statusCode === 429) {
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      const delay = parseInt(retryAfter) * 1000;
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      const finalDelay = Math.max(1000, delay + jitter);
      console.log(`Rate limited: Spotify suggests waiting ${delay}ms, using ${Math.round(finalDelay)}ms with jitter`);
      return finalDelay;
    }
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, consecutiveErrors));
    const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(1000, baseDelay + jitter);
    console.log(`Rate limited: Using exponential backoff ${Math.round(finalDelay)}ms with jitter`);
    return finalDelay;
  }
  return 0;
}



  // Poll for now playing and queue, send to WS clients
  setInterval(async () => {
    if (accessToken) {
      const now = Date.now();

      if (now - lastApiCall < MIN_API_INTERVAL) {
        return;
      }

      try {
        console.log('Polling for updates...');

        if (!checkCircuitBreaker()) {
          console.log('Circuit breaker is OPEN, skipping polling');
          return;
        }

        const nowPlayingLimit = checkEndpointRateLimit('getMyCurrentPlayingTrack');
        const playbackLimit = checkEndpointRateLimit('getMyCurrentPlaybackState');

        if (nowPlayingLimit !== true || playbackLimit !== true) {
          const waitTime = Math.max(
            nowPlayingLimit === true ? 0 : nowPlayingLimit,
            playbackLimit === true ? 0 : playbackLimit
          );
          console.log(`Polling rate limited, waiting ${waitTime}ms`);
          lastApiCall = Date.now() + waitTime;
          return;
        }

        const [nowPlayingRes, queueRes] = await Promise.all([
          spotifyApi.getMyCurrentPlayingTrack(),
          spotifyApi.getMyCurrentPlaybackState()
        ]);

        recordEndpointCall('getMyCurrentPlayingTrack');
        recordEndpointCall('getMyCurrentPlaybackState');
        recordCircuitBreakerResult(true);

        lastApiCall = Date.now();
        consecutiveErrors = 0;

        console.log('Now playing:', nowPlayingRes.body.item ? nowPlayingRes.body.item.name : 'None');
        console.log('Queue length:', (queueRes.body as any).queue ? (queueRes.body as any).queue.length : 0);

        const update = {
          nowPlaying: nowPlayingRes.body.item && 'artists' in nowPlayingRes.body.item ? {
            id: nowPlayingRes.body.item.id,
            name: nowPlayingRes.body.item.name,
            artist: nowPlayingRes.body.item.artists[0].name,
            album: nowPlayingRes.body.item.album.name,
            image: nowPlayingRes.body.item.album.images[0]?.url
          } : null,
          isPlaying: nowPlayingRes.body.is_playing || false,
          queue: (queueRes.body as any).queue ? (queueRes.body as any).queue.slice(0, 10).map((track: any) => ({
            id: track.id,
            name: track.name,
            artist: track.artists[0].name,
            album: track.album.name,
            image: track.album.images[0]?.url
          })) : []
        };

        console.log('Sending WS update with queue:', update.queue.length, 'tracks');
        sendUpdate(update);
      } catch (error: any) {
        console.error('Error polling for WS:', error);
        consecutiveErrors++;
        recordCircuitBreakerResult(false);

        if (error.statusCode === 429) {
          const delay = getRetryAfterDelay(error);
          if (delay > 0) {
            console.log(`Rate limited during polling, waiting ${delay}ms...`);
            lastApiCall = Date.now() + delay;
          } else {
            lastApiCall = Date.now() + 30000;
          }
        }
      }
    }
  }, 30000);

  // Set up token refresh interval
  setInterval(() => {
    if (refreshToken) {
      refreshAccessToken();
    }
  }, 3000000); // Refresh user token every 50 min
}

// WebSocket server started
console.log('WebSocket server module loaded');