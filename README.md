# Song Wall Prototype

A web app for displaying a grid of albums with QR codes. Guests scan to queue tracks on Spotify.

## Updated PRD (v1.1)

Based on implementation changes:

### Key Updates
- **Playback Backend**: Changed from Spotifyd to host's Spotify app for simpler setup
- **Realtime Updates**: WebSocket instead of HTTP polling for instant updates
- **Mobile Access**: Dynamic IP detection for QR codes and API calls
- **Process Management**: Justfile with PM2 support for development
- **Admin Features**: OAuth authentication, playback controls, album management

## Features

- Wall view: Grid of albums with QR codes (dynamic IP for mobile)
- Mobile flow: Scan QR → select track → queue with success feedback
- Real-time Now Playing and Up Next updates via WebSocket (instant, no polling delay)
- Admin dashboard: OAuth login, album management, playback controls (play/pause/skip)
- Spotify app integration for playback on host device (no Spotifyd required)

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
5. WebSocket server (port 3002) for real-time updates.

### 4. Run the App

```bash
just install  # Install dependencies including PM2
just start-all  # Start with PM2 if available
```

- Backend: http://localhost:3001 (HTTP) + ws://localhost:3002 (WebSocket)
- Frontend: http://localhost:3000 (or IP for mobile)
- Admin: http://localhost:3000/admin (or IP)

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

- `just install` - Install all dependencies (including pm2 and ws)
- `just start-backend` - Run backend only (uses pm2 if available)
- `just start-frontend` - Run frontend only (uses pm2 if available)
- `just start-all` - Run backend and frontend
- `just stop` - Stop all processes (uses pm2 if available)
- `just restart` - Restart all processes (uses pm2 if available)
- `just clean` - Remove node_modules

PM2 provides better process management with logs, monitoring, and graceful restarts. If pm2 is not installed, commands fall back to basic process handling. WebSocket server runs on port 3002 for real-time updates.

## Prototype Notes

- Uses JSON file for albums (albums.json)
- In-memory state for queue
- WebSocket for real-time updates (5s backend polling, instant client updates)
- Basic auth for admin (admin/password) + OAuth2 PKCE for Spotify user authentication
- Dynamic IP detection for mobile access
- PM2 process management with fallbacks
- Playback through host's Spotify app (no Spotifyd)