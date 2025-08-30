# Song Wall Prototype

A web app for displaying a grid of albums with QR codes. Guests scan to queue tracks on Spotify.

## Features

- Wall view: Grid of albums with QR codes
- Mobile flow: Scan QR → select track → queue
- Real-time Now Playing and Up Next updates via WebSocket
- Admin dashboard: Login, manage albums, control playback
- Spotify app integration for playback on host device

## Prerequisites

- Node.js (v16+)
- npm
- Spotify Premium account
- Just (command runner): `brew install just` (macOS) or see https://github.com/casey/just
- PM2 (process manager, optional but recommended): `npm install -g pm2`

## Setup

### 1. Clone and Install Dependencies

```bash
git clone <repo>
cd song-wall
just install
```

### 2. Spotify App Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set redirect URI: `http://127.0.0.1:3001/callback`
4. Copy client ID and secret to `backend/.env`

### 3. Spotify App Setup (Playback Backend)

1. Install Spotify app on your laptop (if not already).
2. Log in with your Spotify Premium account.
3. Keep Spotify app running during the event.
4. The web app will control playback through your active Spotify device.

### 4. Run the App

```bash
just start-all
```

- Backend: http://localhost:3001
- Frontend: http://localhost:3000
- Admin: http://localhost:3000/admin

### 5. Admin Setup

1. Go to admin dashboard
2. Login with admin/password
3. Complete Spotify OAuth to enable queue/playback controls

## Usage

1. Project wall on screen
2. Guests scan QR codes to queue tracks
3. View Now Playing and Up Next on wall
4. Admin manages albums and controls playback

## Development

- `just install` - Install all dependencies (including pm2)
- `just start-backend` - Run backend only (uses pm2 if available)
- `just start-frontend` - Run frontend only (uses pm2 if available)
- `just start-all` - Run backend and frontend
- `just stop` - Stop all processes (uses pm2 if available)
- `just restart` - Restart all processes (uses pm2 if available)

- `just clean` - Remove node_modules

PM2 provides better process management with logs, monitoring, and graceful restarts. If pm2 is not installed, commands fall back to basic process handling.

## Prototype Notes

- Uses JSON file for albums (albums.json)
- In-memory state for queue
- WebSocket for real-time updates (5s interval)
- Basic auth for admin (admin/password)
- OAuth2 PKCE for Spotify user authentication