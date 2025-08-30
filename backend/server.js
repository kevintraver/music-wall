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
const wss = new WebSocket.Server({ port: 3002 });
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

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: 'http://127.0.0.1:3001/callback'
});

// Authenticate with Spotify
async function authenticateSpotify() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('Spotify authenticated successfully');
  } catch (error) {
    console.error('Spotify authentication failed:', error);
  }
}

// Initialize authentication
authenticateSpotify();
setInterval(authenticateSpotify, 3600000); // Refresh token every hour
setInterval(() => {
  if (refreshToken) refreshAccessToken();
}, 3000000); // Refresh user token every 50 min

// Poll for now playing and queue, send to WS clients
setInterval(async () => {
  if (accessToken) {
    try {
      console.log('Polling for updates...');
      const nowPlayingRes = await spotifyApi.getMyCurrentPlayingTrack();
      const queueRes = await spotifyApi.getMyCurrentPlaybackState();
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
    }
  }
}, 3000); // Reduced to 3s for even better sync

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
    res.redirect(`http://${localIP}:3000/admin`); // Redirect to admin page
  } catch (error) {
    console.error('Error exchanging code:', error);
    res.status(500).send('Auth failed');
  }
});

// Routes
app.get('/api/albums', async (req, res) => {
  // Just return the albums from JSON without enriching to avoid rate limits
  // The images are already stored in the JSON file
  res.json(albums);
});

// Simple cache to avoid repeated API calls
const albumCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.get('/api/album/:id', async (req, res) => {
  const albumId = req.params.id;
  console.log('Fetching album:', albumId, 'User token available:', !!accessToken);
  
  // Check cache first
  const cached = albumCache.get(albumId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('Returning cached album data for:', albumId);
    return res.json(cached.data);
  }
  
  try {
    // Use user token if available for better access, otherwise use client credentials
    if (accessToken) {
      spotifyApi.setAccessToken(accessToken);
    }
    
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const data = await spotifyApi.getAlbum(albumId);
    console.log('Successfully fetched album from Spotify:', data.body.name, 'with', data.body.tracks.items.length, 'tracks');
    
    const album = {
      id: data.body.id,
      name: data.body.name,
      artist: data.body.artists[0].name,
      image: data.body.images[0]?.url,
      tracks: data.body.tracks.items.map(track => ({
        id: track.id,
        name: track.name,
        duration_ms: track.duration_ms,
        artist: track.artists[0]?.name
      }))
    };
    
    // Cache the result
    albumCache.set(albumId, { data: album, timestamp: Date.now() });
    
    res.json(album);
  } catch (error) {
    console.error('Spotify API error for album', albumId, ':', {
      message: error.message,
      statusCode: error.statusCode,
      body: error.body
    });
    
    // If rate limited, wait and don't hit fallback immediately
    if (error.statusCode === 429) {
      console.log('Rate limited, waiting before fallback...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Fallback to JSON data - reload albums first
    albums = loadAlbums();
    const album = albums.find(a => a.id === albumId);
    if (album) {
      console.log('Using fallback JSON data for album:', albumId, 'with', album.tracks?.length || 0, 'tracks');
      res.json(album);
    } else {
      console.log('Album not found in JSON fallback:', albumId);
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
  res.json({ authenticated: !!accessToken });
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const data = await spotifyApi.searchAlbums(query, { limit: 10 });
    const results = data.body.albums.items.map(album => ({
      id: album.id,
      name: album.name,
      artist: album.artists[0].name,
      image: album.images[0]?.url
    }));
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.json([]);
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
