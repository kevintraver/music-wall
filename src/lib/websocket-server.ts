import WebSocket, { WebSocketServer } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/env';

// Declare global type for WebSocket update function
declare global {
  var sendWebSocketUpdate: (data: any) => void;
  var setSpotifyTokens: (tokens: { accessToken?: string; refreshToken?: string }) => void;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'spotify-tokens.json');

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
const tokensLoaded = loadTokens();
console.log('🔑 WS tokens loaded from file:', tokensLoaded, '| Access:', !!accessToken, 'Refresh:', !!refreshToken);

// Watch for token file changes written by the Next server (OAuth callback or admin sync)
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.watch(DATA_DIR, { persistent: false }, (eventType, filename) => {
    if (filename === 'spotify-tokens.json') {
      try {
        const before = { hasAccess: !!accessToken, hasRefresh: !!refreshToken };
        if (fs.existsSync(TOKEN_FILE)) {
          const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
          accessToken = tokens.accessToken || '';
          refreshToken = tokens.refreshToken || '';
          if (accessToken) spotifyApi.setAccessToken(accessToken);
          console.log('👀 Detected token file change. Tokens reloaded.', { before, after: { hasAccess: !!accessToken, hasRefresh: !!refreshToken } });
          // Trigger immediate broadcast to prime clients
          fetchAndBroadcast().catch(() => {/* ignore */});
        }
      } catch (e) {
        console.warn('Failed to reload tokens after file change:', e);
      }
    }
  });
} catch (e) {
  console.warn('Token file watcher could not be set up:', e);
}

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// Set access token if loaded
if (accessToken) {
  spotifyApi.setAccessToken(accessToken);
  console.log('✅ WebSocket server has access token');
} else {
  console.log('⚠️  WebSocket server has no access token - polling disabled');
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
        client_id: SPOTIFY_CLIENT_ID,
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
    console.log('🔌 WS client connected');
    clients.push(ws);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          console.log('⟲ WS heartbeat pong sent');
          return;
        }
        if (data.type === 'refresh') {
          console.log('🛰️  WS refresh requested by client');
          await fetchAndBroadcast();
          return;
        }
      } catch (error) {
        console.warn('WS message parse error:', error);
      }
    });

    ws.on('close', () => {
      console.log('🔌 WS client disconnected');
      const index = clients.indexOf(ws);
      if (index !== -1) {
        clients.splice(index, 1);
      }
    });

    // Send albums snapshot on connect (from JSON file, if present)
    try {
      const albumsPath = path.join(process.cwd(), 'data', 'albums.json');
      if (fs.existsSync(albumsPath)) {
        const albums = JSON.parse(fs.readFileSync(albumsPath, 'utf8'));
        if (ws.readyState === WebSocket.OPEN) {
          console.log(`📚 Sending albums snapshot: ${albums.length} albums`);
          ws.send(JSON.stringify({ type: 'albums', albums }));
        }
      }
    } catch (_) {
      console.warn('Unable to read albums.json for WS connect snapshot');
    }

    // Send last known playback snapshot if available, then request fresh
    if (lastPlaybackSnapshot && ws.readyState === WebSocket.OPEN) {
      try {
        console.log('🔁 Sending last playback snapshot to new client', {
          nowPlaying: lastPlaybackSnapshot?.nowPlaying?.name || null,
          isPlaying: lastPlaybackSnapshot?.isPlaying ?? null,
          queueSize: Array.isArray(lastPlaybackSnapshot?.queue) ? lastPlaybackSnapshot.queue.length : null,
        });
        ws.send(JSON.stringify(lastPlaybackSnapshot));
      } catch (e) {
        console.warn('Failed to send last playback snapshot:', e);
      }
    }
    fetchAndBroadcast().catch(() => {/* ignore */});
  });

  // Keep last playback snapshot to prime new clients
  let lastPlaybackSnapshot: any = null;

  function sendUpdate(data: any) {
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
    if (data && (Object.prototype.hasOwnProperty.call(data, 'nowPlaying') || Object.prototype.hasOwnProperty.call(data, 'queue') || Object.prototype.hasOwnProperty.call(data, 'isPlaying'))) {
      lastPlaybackSnapshot = data;
      console.log('💾 Updated last playback snapshot', {
        nowPlaying: data?.nowPlaying?.name || null,
        isPlaying: data?.isPlaying ?? null,
        queueSize: Array.isArray(data?.queue) ? data.queue.length : null,
      });
    }
  }

  // Export sendUpdate function for use in API routes
  global.sendWebSocketUpdate = sendUpdate;

  // Allow other parts of the app to update tokens at runtime
  global.setSpotifyTokens = ({ accessToken: at, refreshToken: rt }) => {
    if (at) {
      accessToken = at;
      spotifyApi.setAccessToken(accessToken);
    }
    if (rt) {
      refreshToken = rt;
    }
    try { saveTokens(); } catch {}
    console.log('🔄 WS tokens updated via callback', { hasAccess: !!accessToken, hasRefresh: !!refreshToken });
    // Trigger an immediate broadcast to reflect new auth
    fetchAndBroadcast().catch(() => {/* ignore */});
  };

// Rate limiting and circuit breaker for polling
let lastApiCall = 0;
const MIN_API_INTERVAL = parseInt(process.env.MIN_API_INTERVAL || '200'); // Configurable minimum API interval (default 200ms)
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
  'getMyCurrentPlayingTrack': {
    calls: 0,
    windowStart: Date.now(),
    limit: parseInt(process.env.ENDPOINT_RATE_LIMIT || '50'),
    window: parseInt(process.env.ENDPOINT_RATE_WINDOW || '10000')
  },
  'getMyCurrentPlaybackState': {
    calls: 0,
    windowStart: Date.now(),
    limit: parseInt(process.env.ENDPOINT_RATE_LIMIT || '50'),
    window: parseInt(process.env.ENDPOINT_RATE_WINDOW || '10000')
  },
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


  async function fetchAndBroadcast() {
    if (!accessToken) return;
    const now = Date.now();
    if (now - lastApiCall < MIN_API_INTERVAL) return;

    try {
      console.log(`🔄 Polling Spotify... (clients: ${clients.length}) Access token present: ${!!accessToken}`);

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

      const [nowPlayingRes, playbackStateRes] = await Promise.all([
        spotifyApi.getMyCurrentPlayingTrack(),
        spotifyApi.getMyCurrentPlaybackState()
      ]);
      console.log('🎚 Spotify responses', {
        nowPlayingItem: (nowPlayingRes.body as any)?.item?.name || null,
        isPlayingNP: (nowPlayingRes.body as any)?.is_playing ?? null,
        isPlayingState: (playbackStateRes.body as any)?.is_playing ?? null,
      });
      try {
        const device = (playbackStateRes.body as any)?.device;
        if (device) {
          console.log('🎧 Active device', {
            name: device.name,
            type: device.type,
            is_active: device.is_active,
            volume_percent: device.volume_percent,
          });
        } else {
          console.log('🎧 No active device reported in playback state');
        }
      } catch {}

      recordEndpointCall('getMyCurrentPlayingTrack');
      recordEndpointCall('getMyCurrentPlaybackState');
      recordCircuitBreakerResult(true);

      lastApiCall = Date.now();
      consecutiveErrors = 0;

      const currentItem: any = (nowPlayingRes.body as any)?.item || (playbackStateRes.body as any)?.item || null;
      const update = {
        type: 'playback',
        nowPlaying: currentItem && currentItem.album && currentItem.artists ? {
          id: currentItem.id,
          name: currentItem.name,
          artist: currentItem.artists[0]?.name,
          album: currentItem.album?.name,
          image: currentItem.album?.images?.[0]?.url,
        } : null,
        isPlaying: (nowPlayingRes.body as any)?.is_playing ?? (playbackStateRes.body as any)?.is_playing ?? false,
        queue: [] as any[],
      };

      console.log('📡 Broadcasting playback', {
        clients: clients.length,
        nowPlaying: update.nowPlaying?.name || null,
        isPlaying: update.isPlaying,
      });
      sendUpdate(update);
    } catch (error: any) {
      console.error('❌ Error polling Spotify for WS:', {
        message: error?.message,
        statusCode: error?.statusCode,
        body: error?.body,
      });
      if (error?.statusCode === 401 || error?.statusCode === 403) {
        console.warn('🔐 Spotify token may be invalid or expired. Consider re-authenticating.');
      }
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

  // Poll for now playing and queue, send to WS clients
  setInterval(fetchAndBroadcast, parseInt(process.env.WS_POLLING_INTERVAL || '2000'));

  console.log(`🚀 WebSocket server polling started - interval: ${parseInt(process.env.WS_POLLING_INTERVAL || '2000')}ms`);

  // Set up token refresh interval
  setInterval(() => {
    if (refreshToken) {
      refreshAccessToken();
    }
  }, 3000000); // Refresh user token every 50 min
}

// WebSocket server started
console.log('WebSocket server module loaded');
