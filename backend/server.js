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
let albums = JSON.parse(fs.readFileSync(path.join(__dirname, '../albums.json'), 'utf8'));

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
      const nowPlayingRes = await spotifyApi.getMyCurrentPlayingTrack();
      const queueRes = await spotifyApi.getMyCurrentPlaybackState();
      const update = {
        nowPlaying: nowPlayingRes.body.item ? {
          id: nowPlayingRes.body.item.id,
          name: nowPlayingRes.body.item.name,
          artist: nowPlayingRes.body.item.artists[0].name,
          album: nowPlayingRes.body.item.album.name,
          image: nowPlayingRes.body.item.album.images[0]?.url
        } : null,
        queue: queueRes.body.queue ? queueRes.body.queue.slice(0, 10).map(track => ({
          id: track.id,
          name: track.name,
          artist: track.artists[0].name,
          album: track.album.name
        })) : []
      };
      sendUpdate(update);
    } catch (error) {
      console.error('Error polling for WS:', error);
    }
  }
}, 5000);

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
  try {
    const enrichedAlbums = await Promise.all(albums.map(async (album) => {
      try {
        const data = await spotifyApi.getAlbum(album.id);
        return {
          ...album,
          image: data.body.images[0]?.url || album.image
        };
      } catch (error) {
        console.error('Error fetching album:', album.id, error.message);
        return album;
      }
    }));
    res.json(enrichedAlbums);
  } catch (error) {
    console.error('Error in /api/albums:', error);
    res.json(albums);
  }
});

app.get('/api/album/:id', async (req, res) => {
  const albumId = req.params.id;
  try {
    const data = await spotifyApi.getAlbum(albumId);
    const album = {
      id: data.body.id,
      name: data.body.name,
      artist: data.body.artists[0].name,
      image: data.body.images[0]?.url,
      tracks: data.body.tracks.items.map(track => ({
        id: track.id,
        name: track.name,
        duration_ms: track.duration_ms
      }))
    };
    res.json(album);
  } catch (error) {
    console.error('Error fetching album:', albumId, error.message);
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
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
  }
  const { trackId } = req.body;
  try {
    // Get available devices
    const devices = await spotifyApi.getMyDevices();
    const activeDevice = devices.body.devices.find(d => d.is_active);

    if (!activeDevice) {
      return res.status(400).json({ error: 'No active Spotify device found. Make sure Spotify app is running and logged in.' });
    }

    // Add track to queue
    await spotifyApi.addToQueue(`spotify:track:${trackId}`, { device_id: activeDevice.id });
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

// Playback control endpoints
app.post('/api/playback/play', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Admin not authenticated with Spotify' });
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
  try {
    await spotifyApi.skipToNext();
    res.json({ success: true });
  } catch (error) {
    console.error('Error skipping:', error);
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

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});