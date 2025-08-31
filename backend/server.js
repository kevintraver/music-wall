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
      const [nowPlayingRes, queueRes] = await Promise.all([
        spotifyApi.getMyCurrentPlayingTrack(),
        spotifyApi.getMyCurrentPlaybackState()
      ]);
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

      // Add specific handling for rate limits
      if (error.statusCode === 429) {
        console.log('Rate limited during polling, slowing down...');
        lastApiCall = Date.now() + 30000; // Add 30 second penalty
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

      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        enrichedAlbums.push(cached.data);
        continue;
      }

      try {
        console.log(`Fetching album ${album.id} from Spotify API`);
        const data = await spotifyApiClient.getAlbum(album.id, { market: 'US' });
        const enrichedAlbum = {
          ...album,
          image: data.body.images[0]?.url || album.image
        };
        albumCache.set(cacheKey, { data: enrichedAlbum, timestamp: Date.now() });
        enrichedAlbums.push(enrichedAlbum);
        console.log(`Successfully cached album ${album.id}`);

        // Add small delay between requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        if (error.statusCode === 429) {
          console.log(`Rate limited fetching album ${album.id}, using cached data`);
          enrichedAlbums.push(cached ? cached.data : album);
          continue;
        }
        console.error(`Error fetching album ${album.id}:`, error.message);
        enrichedAlbums.push(album);
      }
    }
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

  try {
    console.log(`Fetching album details and tracks for ${albumId} from Spotify API`);
    // Get album details and tracks in parallel
    const [albumData, tracksData] = await Promise.all([
      spotifyApiClient.getAlbum(albumId, { market: 'US' }),
      spotifyApiClient.getAlbumTracks(albumId, { market: 'US', limit: 50 })
    ]);

    const album = {
      id: albumData.body.id,
      name: albumData.body.name,
      artist: albumData.body.artists[0].name,
      image: albumData.body.images[0]?.url,
      tracks: tracksData.body.items.map(track => ({
        id: track.id,
        name: track.name,
        duration_ms: track.duration_ms,
        artist: track.artists[0]?.name
      }))
    };

    albumCache.set(cacheKey, { data: album, timestamp: Date.now() });
    console.log(`Successfully cached album ${albumId} with ${album.tracks.length} tracks`);
    res.json(album);
  } catch (error) {
    if (error.statusCode === 429) {
      console.log('Rate limited, using cached or fallback data for album:', albumId);
      if (cached) {
        return res.json(cached.data);
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
    const data = await spotifyApiClient.searchAlbums(query, { limit: 10, market: 'US' });
    const results = data.body.albums.items.map(album => ({
      id: album.id,
      name: album.name,
      artist: album.artists[0].name,
      image: album.images[0]?.url
    }));
    res.json(results);
  } catch (error) {
    if (error.statusCode === 429) {
      console.log('Rate limited during search, returning empty results');
      return res.json([]);
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

app.post('/api/admin/albums', (req, res) => {
  const newAlbum = req.body;
  if (!albums.find(a => a.id === newAlbum.id)) {
    albums.push(newAlbum);
    // Save to file
    fs.writeFileSync(path.join(__dirname, '../albums.json'), JSON.stringify(albums, null, 2));
    // Broadcast albums update so clients refresh immediately
    try {
      sendUpdate({ type: 'albums', albums });
    } catch (e) {
      console.error('WS broadcast failed after add:', e);
    }
  }
  res.json({ success: true });
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
