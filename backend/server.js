require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const SpotifyWebApi = require('spotify-web-api-node');
const QRCode = require('qrcode');
const crypto = require('crypto');
const os = require('os');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Get local IP for QR codes
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();
console.log('Local IP for QR codes:', localIP);

// WebSocket server
const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3002;
const wss = new WebSocket.Server({ port: WS_PORT });
console.log('WebSocket server listening on port', WS_PORT);
const clients = [];

wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.push(ws);
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.splice(clients.indexOf(ws), 1);
  });
});

function sendUpdate(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// OAuth variables
let codeVerifier = '';
let accessToken = '';
let refreshToken = '';

// Token persistence
const TOKEN_FILE = path.join(__dirname, 'spotify-tokens.json');

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      accessToken = tokens.accessToken || '';
      refreshToken = tokens.refreshToken || '';
      console.log('Loaded saved Spotify tokens');
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

// PKCE helpers
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
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
        client_id: process.env.SPOTIFY_CLIENT_ID,
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
      saveTokens(); // Save updated tokens
      console.log('Successfully refreshed and saved Spotify tokens');
    } else {
      console.error('Failed to refresh token:', data);
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
  }
}

// Load albums from JSON
function loadAlbums() {
  try {
    const data = fs.readFileSync(path.join(__dirname, '../albums.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading albums.json:', error);
    return [];
  }
}

let albums = loadAlbums();

// Spotify API setup - separate instances for different auth types
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: 'http://127.0.0.1:3001/callback'
});

const spotifyApiClient = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Authenticate with Spotify
async function authenticateSpotify() {
  try {
    const data = await spotifyApiClient.clientCredentialsGrant();
    spotifyApiClient.setAccessToken(data.body['access_token']);
    console.log('Spotify client authenticated successfully at', new Date().toISOString());
  } catch (error) {
    console.error('Spotify client authentication failed:', error);
  }
}

// Load saved tokens on startup
const tokensLoaded = loadTokens();

// Function to update albums that don't have tracks
async function updateAlbumsWithTracks() {
  let updatedCount = 0;
  console.log('Checking for albums without tracks...');

  // Ensure we have client credentials before trying to fetch tracks
  if (!spotifyApiClient.getAccessToken()) {
    console.log('⚠️  No client access token available, attempting to authenticate...');
    await authenticateSpotify();
    
    // If still no token, can't proceed
    if (!spotifyApiClient.getAccessToken()) {
      console.error('❌ Failed to authenticate with Spotify, cannot fetch track data');
      return;
    }
  }

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    if (!album.tracks || album.tracks.length === 0) {
      try {
        console.log(`Updating album "${album.name}" with tracks...`);
        const tracksData = await spotifyApiClient.getAlbumTracks(album.id, { market: 'US', limit: 50 });

        // Validate the response
        if (!tracksData.body || !tracksData.body.items) {
          console.error(`Invalid response for album "${album.name}":`, tracksData.body);
          continue;
        }

        const tracks = tracksData.body.items.map(track => ({
          id: track.id,
          name: track.name,
          duration_ms: track.duration_ms,
          artist: track.artists[0]?.name || album.artist,
          track_number: track.track_number,
          disc_number: track.disc_number
        }));

        albums[i] = {
          ...album,
          tracks: tracks
        };
        updatedCount++;
        console.log(`✅ Updated "${album.name}" with ${tracks.length} tracks`);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
       } catch (error) {
         console.error(`Failed to update tracks for "${album.name}":`, error.message);
         if (error.statusCode === 429) {
           const shouldRetry = await handleRateLimitError(error, `album track update for "${album.name}"`);
           if (shouldRetry) {
             // Retry the operation after rate limit delay
             try {
               const tracksData = await spotifyApiClient.getAlbumTracks(album.id, { market: 'US', limit: 50 });
               if (!tracksData.body || !tracksData.body.items) {
                 console.error(`Invalid response for album "${album.name}":`, tracksData.body);
                 continue;
               }

               const tracks = tracksData.body.items.map(track => ({
                 id: track.id,
                 name: track.name,
                 duration_ms: track.duration_ms,
                 artist: track.artists[0]?.name || album.artist,
                 track_number: track.track_number,
                 disc_number: track.disc_number
               }));

               albums[i] = {
                 ...album,
                 tracks: tracks
               };
               updatedCount++;
               console.log(`✅ Updated "${album.name}" with ${tracks.length} tracks (after retry)`);
             } catch (retryError) {
               console.error(`Retry failed for "${album.name}":`, retryError.message);
             }
           }
         } else if (error.statusCode === 401) {
           console.log('⚠️  Token expired, re-authenticating...');
           await authenticateSpotify();
         }
       }
    }
  }

  if (updatedCount > 0) {
    try {
      fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));
      console.log(`📁 Saved ${updatedCount} updated albums to JSON file`);
    } catch (error) {
      console.error('❌ Failed to save albums.json:', error);
    }
  } else {
    console.log('✅ All albums already have tracks');
  }
}

// Initialize authentication
authenticateSpotify();
setInterval(authenticateSpotify, 3300000); // Refresh token every 55 minutes

// Set up token refresh interval
setInterval(() => {
  if (refreshToken) {
    refreshAccessToken();
  }
}, 3000000); // Refresh user token every 50 min

// If we loaded tokens, try to refresh them immediately to ensure they're valid
if (tokensLoaded && refreshToken) {
  console.log('Attempting to refresh saved tokens on startup...');
  setTimeout(() => {
    refreshAccessToken();
  }, 1000); // Wait 1 second after startup
}

// Check and update albums without tracks (only if needed)
const albumsWithoutTracks = albums.filter(album => !album.tracks || album.tracks.length === 0);
if (albumsWithoutTracks.length > 0) {
  console.log(`Found ${albumsWithoutTracks.length} albums without tracks, updating...`);
  setTimeout(() => {
    updateAlbumsWithTracks();
  }, 2000); // Wait 2 seconds after startup
}

// Log authentication status
console.log('Authentication status on startup:');
console.log('- Access token:', accessToken ? 'Present' : 'Missing');
console.log('- Refresh token:', refreshToken ? 'Present' : 'Missing');
console.log('- Tokens loaded from file:', tokensLoaded);



// Track API call timestamps to implement basic rate limiting
let lastApiCall = 0;
const MIN_API_INTERVAL = 5000; // Minimum 5 seconds between API calls
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

// Circuit breaker for API calls
let circuitBreakerState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
let circuitBreakerFailures = 0;
let circuitBreakerLastFailure = 0;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute timeout when open

function checkCircuitBreaker() {
  const now = Date.now();

  if (circuitBreakerState === 'OPEN') {
    if (now - circuitBreakerLastFailure > CIRCUIT_BREAKER_TIMEOUT) {
      console.log('Circuit breaker transitioning to HALF_OPEN');
      circuitBreakerState = 'HALF_OPEN';
      return true; // Allow one request to test
    }
    return false; // Circuit is open, reject request
  }

  return true; // Circuit is closed or half-open, allow request
}

function recordCircuitBreakerResult(success) {
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
  'getAlbum': { calls: 0, windowStart: Date.now(), limit: 20, window: 30000 }, // 20 calls per 30s
  'getAlbumTracks': { calls: 0, windowStart: Date.now(), limit: 20, window: 30000 },
  'searchAlbums': { calls: 0, windowStart: Date.now(), limit: 10, window: 30000 }, // 10 calls per 30s
  'getMyCurrentPlayingTrack': { calls: 0, windowStart: Date.now(), limit: 3, window: 3000 }, // 3 calls per 3s
  'getMyCurrentPlaybackState': { calls: 0, windowStart: Date.now(), limit: 3, window: 3000 },
  'getMyDevices': { calls: 0, windowStart: Date.now(), limit: 5, window: 30000 },
  'addToQueue': { calls: 0, windowStart: Date.now(), limit: 5, window: 30000 }
};

function checkEndpointRateLimit(endpoint) {
  const now = Date.now();
  const limit = endpointLimits[endpoint];

  if (!limit) return true; // No limit defined for this endpoint

  // Reset window if needed
  if (now - limit.windowStart >= limit.window) {
    limit.calls = 0;
    limit.windowStart = now;
  }

  // Check if we're within limits
  if (limit.calls >= limit.limit) {
    const waitTime = limit.window - (now - limit.windowStart);
    console.log(`Endpoint ${endpoint} rate limited: ${limit.calls}/${limit.limit} calls in window, wait ${waitTime}ms`);
    return waitTime;
  }

  return true;
}

function recordEndpointCall(endpoint) {
  const limit = endpointLimits[endpoint];
  if (limit) {
    limit.calls++;
  }
}

// Rate limit handling utilities
function getRetryAfterDelay(error) {
  if (error.statusCode === 429) {
    // Check for Retry-After header (in seconds)
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      const delay = parseInt(retryAfter) * 1000; // Convert to milliseconds
      // Add jitter (±25%) to prevent thundering herd
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      const finalDelay = Math.max(1000, delay + jitter); // Minimum 1 second
      console.log(`Rate limited: Spotify suggests waiting ${delay}ms, using ${Math.round(finalDelay)}ms with jitter`);
      return finalDelay;
    }
    // Fallback to exponential backoff with jitter if no Retry-After header
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, consecutiveErrors)); // Max 30 seconds
    const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1); // ±10% jitter
    const finalDelay = Math.max(1000, baseDelay + jitter);
    console.log(`Rate limited: Using exponential backoff ${Math.round(finalDelay)}ms with jitter`);
    return finalDelay;
  }
  return 0;
}

function categorizeError(error) {
  if (error.statusCode) {
    switch (error.statusCode) {
      case 429:
        return 'RATE_LIMIT';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 500:
      case 502:
      case 503:
        return 'SERVER_ERROR';
      default:
        return 'CLIENT_ERROR';
    }
  }
  return 'NETWORK_ERROR';
}

async function handleRateLimitError(error, operation = 'API call') {
  const errorType = categorizeError(error);

  if (errorType === 'RATE_LIMIT') {
    const delay = getRetryAfterDelay(error);
    if (delay > 0) {
      console.log(`Rate limited during ${operation}, waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return true; // Indicates we should retry
    }
  } else if (errorType === 'UNAUTHORIZED') {
    console.log(`Authentication error during ${operation}, may need to refresh token`);
  } else if (errorType === 'SERVER_ERROR') {
    console.log(`Server error during ${operation}, may be temporary`);
  }

  return false; // Don't retry
}

// Poll for now playing and queue, send to WS clients
setInterval(async () => {
  if (accessToken) {
    const now = Date.now();

    // If we've had too many consecutive errors, slow down polling
    const currentInterval = consecutiveErrors > MAX_CONSECUTIVE_ERRORS ? 60000 : 30000; // 1 min or 30 sec

    if (now - lastApiCall < MIN_API_INTERVAL) {
      return; // Skip this polling cycle to avoid rate limits
    }

    try {
       console.log('Polling for updates...');

       // Check circuit breaker
       if (!checkCircuitBreaker()) {
         console.log('Circuit breaker is OPEN, skipping polling');
         return;
       }

       // Check rate limits for polling endpoints
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

       // Record successful calls
       recordEndpointCall('getMyCurrentPlayingTrack');
       recordEndpointCall('getMyCurrentPlaybackState');
       recordCircuitBreakerResult(true); // Success

       lastApiCall = Date.now();
       consecutiveErrors = 0; // Reset error count on success

       console.log('Now playing:', nowPlayingRes.body.item ? nowPlayingRes.body.item.name : 'None');
       console.log('Queue length:', queueRes.body.queue ? queueRes.body.queue.length : 0);
       const update = {
         nowPlaying: nowPlayingRes.body.item ? {
           id: nowPlayingRes.body.item.id,
           name: nowPlayingRes.body.item.name,
           artist: nowPlayingRes.body.item.artists[0].name,
           album: nowPlayingRes.body.item.album.name,
           image: nowPlayingRes.body.item.album.images[0]?.url
         } : null,
         isPlaying: nowPlayingRes.body.is_playing || false,
         queue: queueRes.body.queue ? queueRes.body.queue.slice(0, 10).map(track => ({
           id: track.id,
           name: track.name,
           artist: track.artists[0].name,
           album: track.album.name,
           image: track.album.images[0]?.url
         })) : []
       };
       console.log('Sending WS update with queue:', update.queue.length, 'tracks');
       sendUpdate(update);
     } catch (error) {
       console.error('Error polling for WS:', error);
       consecutiveErrors++;
       recordCircuitBreakerResult(false); // Failure

       // Add specific handling for rate limits
       if (error.statusCode === 429) {
         const delay = getRetryAfterDelay(error);
         if (delay > 0) {
           console.log(`Rate limited during polling, waiting ${delay}ms...`);
           lastApiCall = Date.now() + delay;
         } else {
           lastApiCall = Date.now() + 30000; // Fallback 30 second penalty
         }
       }
     }
  }
}, 30000); // Poll every 30 seconds to reduce API load

// OAuth routes
app.get('/auth/login', (req, res) => {
  codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const scopes = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private';
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${process.env.SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent('http://127.0.0.1:3001/callback')}&code_challenge_method=S256&code_challenge=${codeChallenge}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://127.0.0.1:3001/callback',
        code_verifier: codeVerifier,
      }),
    });
    const data = await response.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    spotifyApi.setAccessToken(accessToken);
    saveTokens(); // Save tokens to file
    console.log('Successfully authenticated and saved Spotify tokens');
    res.redirect(`http://${localIP}:3000/admin`); // Redirect to admin page
  } catch (error) {
    console.error('Error exchanging code:', error);
    res.status(500).send('Auth failed');
  }
});

// Simple cache for album data
const albumCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// Rate limiting for album requests
const albumRequestTimes = new Map();
const ALBUM_REQUEST_LIMIT = 10; // Max 10 album requests per minute
const ALBUM_REQUEST_WINDOW = 60000; // 1 minute window

// Clear old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of albumCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      albumCache.delete(key);
    }
  }
  console.log(`Cache cleanup: ${albumCache.size} entries remaining`);
}, 600000); // Clean up every 10 minutes

// Clean up old request times
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of albumRequestTimes.entries()) {
    const recentTimes = times.filter(time => now - time < ALBUM_REQUEST_WINDOW);
    if (recentTimes.length === 0) {
      albumRequestTimes.delete(key);
    } else {
      albumRequestTimes.set(key, recentTimes);
    }
  }
}, 30000); // Clean up every 30 seconds

// Routes
app.get('/api/albums', async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  // Check rate limit
  const requestTimes = albumRequestTimes.get(clientIP) || [];
  const recentRequests = requestTimes.filter(time => now - time < ALBUM_REQUEST_WINDOW);

  if (recentRequests.length >= ALBUM_REQUEST_LIMIT) {
    console.log(`Rate limit exceeded for ${clientIP}, returning cached data`);
    const cachedAlbums = [];
    for (const album of albums) {
      const cacheKey = `album_${album.id}`;
      const cached = albumCache.get(cacheKey);
      cachedAlbums.push(cached ? cached.data : album);
    }
    return res.json(cachedAlbums);
  }

  // Add this request to the tracking
  recentRequests.push(now);
  albumRequestTimes.set(clientIP, recentRequests);

  try {
    const enrichedAlbums = [];
    for (const album of albums) {
      const cacheKey = `album_${album.id}`;
      const cached = albumCache.get(cacheKey);

      // If we have a cached version and it's still fresh, use it
      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        enrichedAlbums.push(cached.data);
        continue;
      }

      // If the album already has an image from the JSON file, use it directly
      if (album.image && album.image.startsWith('http')) {
        console.log(`✅ Using local data for album "${album.name}" (no API call needed)`);
        albumCache.set(cacheKey, { data: album, timestamp: Date.now() });
        enrichedAlbums.push(album);
        continue;
      }

       // Only fetch from Spotify API if we don't have an image
       try {
         // Check rate limit for getAlbum endpoint
         const rateLimitCheck = checkEndpointRateLimit('getAlbum');
         if (rateLimitCheck !== true) {
           console.log(`Rate limited fetching album ${album.id}, using local data`);
           enrichedAlbums.push(album);
           continue;
         }

         console.log(`Fetching missing image for album ${album.id} from Spotify API`);
         const data = await spotifyApiClient.getAlbum(album.id, { market: 'US' });
         const enrichedAlbum = {
           ...album,
           image: data.body.images[0]?.url || album.image
         };

         // Record successful call
         recordEndpointCall('getAlbum');

         albumCache.set(cacheKey, { data: enrichedAlbum, timestamp: Date.now() });
         enrichedAlbums.push(enrichedAlbum);
         console.log(`Successfully cached album ${album.id} with fresh image`);

         // Add small delay between requests to avoid rate limits
         await new Promise(resolve => setTimeout(resolve, 200));
       } catch (error) {
         if (error.statusCode === 429) {
           const shouldRetry = await handleRateLimitError(error, `album fetch for ${album.id}`);
           if (shouldRetry) {
             // Retry the operation
             try {
               const data = await spotifyApiClient.getAlbum(album.id, { market: 'US' });
               const enrichedAlbum = {
                 ...album,
                 image: data.body.images[0]?.url || album.image
               };
               albumCache.set(cacheKey, { data: enrichedAlbum, timestamp: Date.now() });
               enrichedAlbums.push(enrichedAlbum);
               console.log(`Successfully cached album ${album.id} with fresh image (after retry)`);
             } catch (retryError) {
               console.log(`Rate limited fetching album ${album.id}, using local data`);
               enrichedAlbums.push(album); // Use local data as fallback
             }
           } else {
             console.log(`Rate limited fetching album ${album.id}, using local data`);
             enrichedAlbums.push(album); // Use local data as fallback
           }
         } else {
           console.error(`Error fetching album ${album.id}:`, error.message);
           enrichedAlbums.push(album); // Use local data as fallback
         }
       }
    }

    // Log summary of data sources
    const localCount = enrichedAlbums.filter(album => {
      const original = albums.find(a => a.id === album.id);
      return original && original.image === album.image;
    }).length;

    const apiCount = enrichedAlbums.length - localCount;
    console.log(`📊 Albums served: ${localCount} from local data, ${apiCount} from Spotify API`);

    res.json(enrichedAlbums);
  } catch (error) {
    console.error('Error in /api/albums:', error);
    res.json(albums);
  }
});



app.get('/api/album/:id', async (req, res) => {
  const albumId = req.params.id;
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  // Check rate limit for individual album requests
  const requestTimes = albumRequestTimes.get(clientIP) || [];
  const recentRequests = requestTimes.filter(time => now - time < ALBUM_REQUEST_WINDOW);

  if (recentRequests.length >= ALBUM_REQUEST_LIMIT) {
    console.log(`Rate limit exceeded for ${clientIP} on album ${albumId}`);
    const cacheKey = `album_tracks_${albumId}`;
    const cached = albumCache.get(cacheKey);
    if (cached) {
      return res.json(cached.data);
    } else {
      const album = albums.find(a => a.id === albumId);
      return res.json(album || { error: 'Album not found' });
    }
  }

  // Add this request to the tracking
  recentRequests.push(now);
  albumRequestTimes.set(clientIP, recentRequests);

  const cacheKey = `album_tracks_${albumId}`;
  const cached = albumCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return res.json(cached.data);
  }

  // Check if we have basic album info locally
  const localAlbum = albums.find(a => a.id === albumId);
  if (!localAlbum) {
    return res.status(404).json({ error: 'Album not found' });
  }

  // If we have tracks stored locally, use them
  if (localAlbum.tracks && localAlbum.tracks.length > 0) {
    console.log(`✅ Using local tracks for album "${localAlbum.name}" (${localAlbum.tracks.length} tracks)`);
    const albumWithLocalTracks = {
      id: localAlbum.id,
      name: localAlbum.name,
      artist: localAlbum.artist,
      image: localAlbum.image,
      tracks: localAlbum.tracks
    };
    albumCache.set(cacheKey, { data: albumWithLocalTracks, timestamp: Date.now() });
    return res.json(albumWithLocalTracks);
  }

  // Only fetch from Spotify if we don't have local tracks
  try {
    console.log(`Fetching album details and tracks for ${albumId} from Spotify API`);
    
    // Ensure we have client access token
    if (!spotifyApiClient.getAccessToken()) {
      console.log('⚠️  No client access token, attempting to authenticate...');
      await authenticateSpotify();
    }

    // Check rate limits for both endpoints
    const albumLimit = checkEndpointRateLimit('getAlbum');
    const tracksLimit = checkEndpointRateLimit('getAlbumTracks');

    if (albumLimit !== true || tracksLimit !== true) {
      console.log(`Rate limited fetching album details for ${albumId}, using cached data`);
      if (cached) {
        return res.json(cached.data);
      }
      const album = albums.find(a => a.id === albumId);
      return res.json(album || { error: 'Album not found' });
    }

    // Get album details and tracks in parallel
    const [albumData, tracksData] = await Promise.all([
      spotifyApiClient.getAlbum(albumId, { market: 'US' }),
      spotifyApiClient.getAlbumTracks(albumId, { market: 'US', limit: 50 })
    ]);

    // Record successful calls
    recordEndpointCall('getAlbum');
    recordEndpointCall('getAlbumTracks');

    const tracks = tracksData.body.items.map(track => ({
      id: track.id,
      name: track.name,
      duration_ms: track.duration_ms,
      artist: track.artists[0]?.name || albumData.body.artists[0].name,
      track_number: track.track_number,
      disc_number: track.disc_number
    }));

    const album = {
      id: albumData.body.id,
      name: albumData.body.name,
      artist: albumData.body.artists[0].name,
      image: albumData.body.images[0]?.url || localAlbum.image, // Use local image as fallback
      tracks: tracks
    };

    // Update the local albums array and save to file to avoid future API calls
    const albumIndex = albums.findIndex(a => a.id === albumId);
    if (albumIndex !== -1) {
      albums[albumIndex] = { ...albums[albumIndex], tracks: tracks };
      try {
        fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));
        console.log(`📁 Saved tracks for "${album.name}" to albums.json`);
      } catch (saveError) {
        console.error('❌ Failed to save updated tracks to albums.json:', saveError);
      }
    }

    albumCache.set(cacheKey, { data: album, timestamp: Date.now() });
    console.log(`Successfully cached album ${albumId} with ${album.tracks.length} tracks`);
    res.json(album);
   } catch (error) {
     if (error.statusCode === 429) {
       const shouldRetry = await handleRateLimitError(error, `album details fetch for ${albumId}`);
       if (shouldRetry) {
         // Retry the operation
         try {
           const [albumData, tracksData] = await Promise.all([
             spotifyApiClient.getAlbum(albumId, { market: 'US' }),
             spotifyApiClient.getAlbumTracks(albumId, { market: 'US', limit: 50 })
           ]);

           const tracks = tracksData.body.items.map(track => ({
             id: track.id,
             name: track.name,
             duration_ms: track.duration_ms,
             artist: track.artists[0]?.name || albumData.body.artists[0].name,
             track_number: track.track_number,
             disc_number: track.disc_number
           }));

           const album = {
             id: albumData.body.id,
             name: albumData.body.name,
             artist: albumData.body.artists[0].name,
             image: albumData.body.images[0]?.url || localAlbum.image,
             tracks: tracks
           };

           albumCache.set(cacheKey, { data: album, timestamp: Date.now() });
           console.log(`Successfully cached album ${albumId} with ${album.tracks.length} tracks (after retry)`);
           return res.json(album);
         } catch (retryError) {
           console.log('Rate limited, using cached or fallback data for album:', albumId);
           if (cached) {
             return res.json(cached.data);
           }
         }
       } else {
         console.log('Rate limited, using cached or fallback data for album:', albumId);
         if (cached) {
           return res.json(cached.data);
         }
       }
     }

     console.error('Error fetching album:', albumId, error);
     console.error('Error details:', {
       statusCode: error.statusCode,
       message: error.message,
       body: error.body
     });

     // Fallback to JSON
     const album = albums.find(a => a.id === albumId);
     if (album) {
       res.json(album);
     } else {
       res.status(404).json({ error: 'Album not found' });
     }
   }
});

app.post('/api/queue', async (req, res) => {
  console.log('Queue request received for track:', req.body.trackId);
  if (!accessToken) {
    console.log('No access token');
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }
  const { trackId } = req.body;
  try {
    // Check rate limits for queue operations
    const devicesLimit = checkEndpointRateLimit('getMyDevices');
    const queueLimit = checkEndpointRateLimit('addToQueue');

    if (devicesLimit !== true || queueLimit !== true) {
      return res.status(429).json({ error: 'Rate limited, please try again later.' });
    }

    // Get available devices
    const devices = await spotifyApi.getMyDevices();
    console.log('Devices found:', devices.body.devices.length);
    const activeDevice = devices.body.devices.find(d => d.is_active);
    console.log('Active device:', activeDevice ? activeDevice.name : 'None');

    if (!activeDevice) {
      return res.status(400).json({ error: 'No active Spotify device found. Make sure Spotify app is running and logged in.' });
    }

    // Add track to queue
    await spotifyApi.addToQueue(`spotify:track:${trackId}`, { device_id: activeDevice.id });

    // Record successful calls
    recordEndpointCall('getMyDevices');
    recordEndpointCall('addToQueue');

    console.log('Track added to queue successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding to queue:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/now-playing', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }
  try {
    const data = await spotifyApi.getMyCurrentPlayingTrack();
    if (data.body.item) {
      res.json({
        id: data.body.item.id,
        name: data.body.item.name,
        artist: data.body.item.artists[0].name,
        album: data.body.item.album.name,
        image: data.body.item.album.images[0]?.url
      });
    } else {
      res.json(null);
    }
  } catch (error) {
    console.error('Error getting now playing:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/queue', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }
  try {
    const data = await spotifyApi.getMyCurrentPlaybackState();
    if (data.body.queue) {
      const queue = data.body.queue.slice(0, 10).map(track => ({
        id: track.id,
        name: track.name,
        artist: track.artists[0].name,
        album: track.album.name
      }));
      res.json(queue);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error getting queue:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/qr/:albumId', async (req, res) => {
  const albumId = req.params.albumId;
  const url = `http://${localIP}:3000/album/${albumId}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Throttling for playback controls
const playbackThrottle = {
  play: { lastCall: 0, minInterval: 1000 }, // 1 second minimum between play calls
  pause: { lastCall: 0, minInterval: 1000 }, // 1 second minimum between pause calls
  next: { lastCall: 0, minInterval: 1000 } // 1 second minimum between next calls
};

function isThrottled(action) {
  const now = Date.now();
  const throttle = playbackThrottle[action];
  if (now - throttle.lastCall < throttle.minInterval) {
    return true;
  }
  throttle.lastCall = now;
  return false;
}

// Playback control endpoints
app.get('/api/playback/status', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }
  try {
    const data = await spotifyApi.getMyCurrentPlaybackState();
    res.json({
      isPlaying: data.body?.is_playing || false
    });
  } catch (error) {
    console.error('Error getting playback status:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/playback/play', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }

  if (isThrottled('play')) {
    return res.status(429).json({ error: 'Playback commands are being sent too frequently. Please wait a moment.' });
  }

  try {
    const devices = await spotifyApi.getMyDevices();
    const activeDevice = devices.body.devices.find(d => d.is_active);

    if (activeDevice) {
      await spotifyApi.play({ device_id: activeDevice.id });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'No active Spotify device found' });
    }
  } catch (error) {
    console.error('Error playing:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/playback/pause', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }

  if (isThrottled('pause')) {
    return res.status(429).json({ error: 'Playback commands are being sent too frequently. Please wait a moment.' });
  }

  try {
    await spotifyApi.pause();
    res.json({ success: true });
  } catch (error) {
    console.error('Error pausing:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/playback/next', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }

  if (isThrottled('next')) {
    return res.status(429).json({ error: 'Playback commands are being sent too frequently. Please wait a moment.' });
  }

  try {
    await spotifyApi.skipToNext();
    res.json({ success: true });
  } catch (error) {
    console.error('Error skipping:', error);
    res.status(500).json({ error: error.message });
  }
});

// Immediate state verification endpoint
app.get('/api/playback/verify', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }

  try {
    const [nowPlayingRes, playbackStateRes] = await Promise.all([
      spotifyApi.getMyCurrentPlayingTrack(),
      spotifyApi.getMyCurrentPlaybackState()
    ]);

    const verifiedState = {
      nowPlaying: nowPlayingRes.body.item ? {
        id: nowPlayingRes.body.item.id,
        name: nowPlayingRes.body.item.name,
        artist: nowPlayingRes.body.item.artists[0].name,
        album: nowPlayingRes.body.item.album.name,
        image: nowPlayingRes.body.item.album.images[0]?.url
      } : null,
      isPlaying: nowPlayingRes.body.is_playing || false,
      queue: playbackStateRes.body.queue ? playbackStateRes.body.queue.slice(0, 10).map(track => ({
        id: track.id,
        name: track.name,
        artist: track.artists[0].name,
        album: track.album.name,
        image: track.album.images[0]?.url
      })) : []
    };

    res.json(verifiedState);
  } catch (error) {
    console.error('Error verifying playback state:', error);
    res.status(500).json({ error: error.message });
  }
});

// Force sync endpoint - manually trigger WebSocket update
app.post('/api/playback/sync', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }

  try {
    const [nowPlayingRes, playbackStateRes] = await Promise.all([
      spotifyApi.getMyCurrentPlayingTrack(),
      spotifyApi.getMyCurrentPlaybackState()
    ]);

    const syncUpdate = {
      type: 'sync',
      nowPlaying: nowPlayingRes.body.item ? {
        id: nowPlayingRes.body.item.id,
        name: nowPlayingRes.body.item.name,
        artist: nowPlayingRes.body.item.artists[0].name,
        album: nowPlayingRes.body.item.album.name,
        image: nowPlayingRes.body.item.album.images[0]?.url
      } : null,
      isPlaying: nowPlayingRes.body.is_playing || false,
      queue: playbackStateRes.body.queue ? playbackStateRes.body.queue.slice(0, 10).map(track => ({
        id: track.id,
        name: track.name,
        artist: track.artists[0].name,
        album: track.album.name,
        image: track.album.images[0]?.url
      })) : []
    };

    // Send immediate WebSocket update
    sendUpdate(syncUpdate);
    console.log('Manual sync triggered, WebSocket update sent');

    res.json({ success: true, state: syncUpdate });
  } catch (error) {
    console.error('Error during manual sync:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin routes
app.post('/api/admin/login', (req, res) => {
  // Basic auth check, then redirect to Spotify OAuth
  const { username, password } = req.body;
  if (username === 'admin' && password === 'password') {
    res.json({ redirect: '/auth/login' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/admin/status', (req, res) => {
  res.json({
    authenticated: !!accessToken,
    hasRefreshToken: !!refreshToken,
    tokensLoaded: tokensLoaded
  });
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    // Check rate limit for search endpoint
    const rateLimitCheck = checkEndpointRateLimit('searchAlbums');
    if (rateLimitCheck !== true) {
      console.log('Rate limited during search, returning empty results');
      return res.json([]);
    }

    const data = await spotifyApiClient.searchAlbums(query, { limit: 10, market: 'US' });
    const results = data.body.albums.items.map(album => ({
      id: album.id,
      name: album.name,
      artist: album.artists[0].name,
      image: album.images[0]?.url
    }));

    // Record successful call
    recordEndpointCall('searchAlbums');

    res.json(results);
  } catch (error) {
     if (error.statusCode === 429) {
       const shouldRetry = await handleRateLimitError(error, 'album search');
       if (shouldRetry) {
         // Retry the search operation
         try {
           const data = await spotifyApiClient.searchAlbums(query, { limit: 10, market: 'US' });
           const results = data.body.albums.items.map(album => ({
             id: album.id,
             name: album.name,
             artist: album.artists[0].name,
             image: album.images[0]?.url
           }));
           return res.json(results);
         } catch (retryError) {
           console.log('Rate limited during search retry, returning empty results');
           return res.json([]);
         }
       } else {
         console.log('Rate limited during search, returning empty results');
         return res.json([]);
       }
     }
     console.error('Search error:', error);
     res.json([]);
   }
});

// Debug endpoint to check cache and API status
app.get('/api/debug', (req, res) => {
  const now = Date.now();
  const cacheInfo = Array.from(albumCache.entries()).map(([key, value]) => ({
    key,
    age: Math.round((now - value.timestamp) / 1000),
    ageMinutes: Math.round((now - value.timestamp) / 60000)
  }));

  const albumsWithTracks = albums.filter(album => album.tracks && album.tracks.length > 0).length;
  const totalTracks = albums.reduce((sum, album) => sum + (album.tracks ? album.tracks.length : 0), 0);

  res.json({
    cacheSize: albumCache.size,
    cacheEntries: cacheInfo,
    lastApiCall: lastApiCall,
    timeSinceLastApiCall: Math.round((now - lastApiCall) / 1000),
    authentication: {
      accessToken: !!accessToken,
      refreshToken: !!refreshToken,
      tokensLoaded: tokensLoaded,
      clientToken: !!spotifyApiClient.getAccessToken()
    },
    albumData: {
      totalAlbums: albums.length,
      albumsWithTracks,
      albumsWithoutTracks: albums.length - albumsWithTracks,
      totalTracks
    },
    consecutiveErrors,
    rateLimitTracking: {
      totalTrackedIPs: albumRequestTimes.size,
      currentIP: req.ip || req.connection.remoteAddress
    }
  });
});

// Endpoint to clear saved tokens (useful for testing)
app.post('/api/admin/clear-tokens', (req, res) => {
  try {
    accessToken = '';
    refreshToken = '';
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
      console.log('Cleared saved Spotify tokens');
    }
    res.json({ success: true, message: 'Tokens cleared' });
  } catch (error) {
    console.error('Error clearing tokens:', error);
    res.status(500).json({ error: 'Failed to clear tokens' });
  }
});

app.post('/api/admin/albums', async (req, res) => {
  const newAlbum = req.body;
  if (!albums.find(a => a.id === newAlbum.id)) {
    try {
      console.log(`Adding new album: ${newAlbum.name} (${newAlbum.id})`);

      // Ensure we have client access token
      if (!spotifyApiClient.getAccessToken()) {
        console.log('⚠️  No client access token for admin add, attempting to authenticate...');
        await authenticateSpotify();
      }

      // Fetch complete album data including tracks from Spotify
      const [albumData, tracksData] = await Promise.all([
        spotifyApiClient.getAlbum(newAlbum.id, { market: 'US' }),
        spotifyApiClient.getAlbumTracks(newAlbum.id, { market: 'US', limit: 50 })
      ]);

      // Validate responses
      if (!albumData.body || !tracksData.body || !tracksData.body.items) {
        throw new Error('Invalid response from Spotify API');
      }

      // Create complete album object with tracks
      const completeAlbum = {
        id: albumData.body.id,
        name: albumData.body.name,
        artist: albumData.body.artists[0].name,
        image: albumData.body.images[0]?.url || newAlbum.image,
        position: newAlbum.position || albums.length,
        tracks: tracksData.body.items.map(track => ({
          id: track.id,
          name: track.name,
          duration_ms: track.duration_ms,
          artist: track.artists[0]?.name || albumData.body.artists[0].name,
          track_number: track.track_number,
          disc_number: track.disc_number
        }))
      };

      albums.push(completeAlbum);
      console.log(`✅ Added album "${completeAlbum.name}" with ${completeAlbum.tracks.length} tracks`);

      // Save to file
      fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));

      // Broadcast albums update so clients refresh immediately
      try {
        sendUpdate({ type: 'albums', albums });
      } catch (e) {
        console.error('WS broadcast failed after add:', e);
      }

      res.json({
        success: true,
        album: completeAlbum,
        tracksCount: completeAlbum.tracks.length
      });

     } catch (error) {
       console.error('Error fetching album data for admin add:', error);

       if (error.statusCode === 429) {
         const shouldRetry = await handleRateLimitError(error, `admin add album ${newAlbum.name}`);
         if (shouldRetry) {
           // Retry the operation
           try {
             const [albumData, tracksData] = await Promise.all([
               spotifyApiClient.getAlbum(newAlbum.id, { market: 'US' }),
               spotifyApiClient.getAlbumTracks(newAlbum.id, { market: 'US', limit: 50 })
             ]);

             if (!albumData.body || !tracksData.body || !tracksData.body.items) {
               throw new Error('Invalid response from Spotify API');
             }

             const completeAlbum = {
               id: albumData.body.id,
               name: albumData.body.name,
               artist: albumData.body.artists[0].name,
               image: albumData.body.images[0]?.url || newAlbum.image,
               position: newAlbum.position || albums.length,
               tracks: tracksData.body.items.map(track => ({
                 id: track.id,
                 name: track.name,
                 duration_ms: track.duration_ms,
                 artist: track.artists[0]?.name || albumData.body.artists[0].name,
                 track_number: track.track_number,
                 disc_number: track.disc_number
               }))
             };

             albums.push(completeAlbum);
             console.log(`✅ Added album "${completeAlbum.name}" with ${completeAlbum.tracks.length} tracks (after retry)`);

             fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));

             try {
               sendUpdate({ type: 'albums', albums });
             } catch (e) {
               console.error('WS broadcast failed after add:', e);
             }

             return res.json({
               success: true,
               album: completeAlbum,
               tracksCount: completeAlbum.tracks.length
             });
           } catch (retryError) {
             console.error('Retry failed for admin add:', retryError);
           }
         }
       }

       // Fallback: add basic album data if Spotify fetch fails
       console.log('⚠️  Falling back to basic album data');
       const basicAlbum = {
         ...newAlbum,
         tracks: [] // Empty tracks array as fallback
       };
       albums.push(basicAlbum);
       fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));

       try {
         sendUpdate({ type: 'albums', albums });
       } catch (e) {
         console.error('WS broadcast failed after add:', e);
       }

       res.json({
         success: true,
         album: basicAlbum,
         tracksCount: 0,
         warning: 'Album added with basic data only (Spotify fetch failed)'
       });
     }
  } else {
    res.status(400).json({ error: 'Album already exists' });
  }
});

app.delete('/api/admin/albums/:id', (req, res) => {
  const id = req.params.id;
  albums = albums.filter(a => a.id !== id);
  fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));
  // Broadcast albums update after delete
  try {
    sendUpdate({ type: 'albums', albums });
  } catch (e) {
    console.error('WS broadcast failed after delete:', e);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
app.post('/api/admin/albums/reorder', (req, res) => {
  const reorderedAlbums = req.body;
  if (!Array.isArray(reorderedAlbums)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Update the albums array with new positions
  albums = reorderedAlbums.map((album, index) => ({
    ...album,
    position: index
  }));

  // Save to JSON file
  fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));

  // Send WebSocket update to all clients
  sendUpdate({ type: 'albums', albums });

  res.json({ success: true });
});
