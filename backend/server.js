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

// In-memory state
let currentPlaying = null;
let queue = [];

// Spotify API setup (placeholder)
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: 'http://localhost:3001/callback'
});

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
  // Add to Spotify queue
  // For now, just add to in-memory queue
  queue.push(trackId);
  res.json({ success: true });
});

app.get('/api/now-playing', (req, res) => {
  res.json(currentPlaying);
});

app.get('/api/queue', (req, res) => {
  res.json(queue);
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

// Admin routes (placeholder)
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