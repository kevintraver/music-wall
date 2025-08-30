require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const SpotifyWebApi = require('spotify-web-api-node');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

// Routes
app.get('/api/albums', (req, res) => {
  res.json(albums);
});

app.get('/api/album/:id', async (req, res) => {
  const albumId = req.params.id;
  try {
    // In prototype, just return from JSON or fetch from Spotify
    const album = albums.find(a => a.id === albumId);
    if (album) {
      // Fetch tracks from Spotify if needed
      res.json(album);
    } else {
      res.status(404).json({ error: 'Album not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/queue', async (req, res) => {
  const { trackId } = req.body;
  try {
    // Get available devices
    const devices = await spotifyApi.getMyDevices();
    const songwallDevice = devices.body.devices.find(d => d.name === 'SongWall Player');

    if (!songwallDevice) {
      return res.status(400).json({ error: 'SongWall Player device not found. Make sure Spotifyd is running.' });
    }

    // Add track to queue
    await spotifyApi.addToQueue(`spotify:track:${trackId}`, { device_id: songwallDevice.id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding to queue:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/now-playing', async (req, res) => {
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
  const url = `http://localhost:3000/album/${albumId}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Playback control endpoints
app.post('/api/playback/play', async (req, res) => {
  try {
    const devices = await spotifyApi.getMyDevices();
    const songwallDevice = devices.body.devices.find(d => d.name === 'SongWall Player');

    if (songwallDevice) {
      await spotifyApi.play({ device_id: songwallDevice.id });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'SongWall Player device not found' });
    }
  } catch (error) {
    console.error('Error playing:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/playback/pause', async (req, res) => {
  try {
    await spotifyApi.pause();
    res.json({ success: true });
  } catch (error) {
    console.error('Error pausing:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/playback/next', async (req, res) => {
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
  // Basic auth
  const { username, password } = req.body;
  if (username === 'admin' && password === 'password') {
    res.json({ token: 'fake-token' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});