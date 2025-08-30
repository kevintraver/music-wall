# Song Wall Prototype

A web app for displaying a grid of albums with QR codes. Guests scan to queue tracks on Spotify.

## Features

- Wall view: Grid of albums with QR codes
- Mobile flow: Scan QR → select track → queue
- Now Playing and Up Next bars
- Admin dashboard: Login, manage albums, control playback
- Spotifyd integration for playback on host device

## Prerequisites

- Node.js (v16+)
- npm
- Spotify Premium account
- Just (command runner): `brew install just` (macOS) or see https://github.com/casey/just

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

### 3. Spotifyd Setup (Playback Backend)

1. Install Spotifyd:
   - macOS: `brew install spotifyd`
   - Linux: `sudo apt-get install spotifyd`
   - Windows: Download from GitHub releases

2. Create config file:
   - macOS: `~/Library/Application Support/Spotifyd/spotifyd.conf`
   - Linux: `~/.config/spotifyd/spotifyd.conf`
   - Windows: `%APPDATA%\Spotifyd\spotifyd.conf`

   Example config:
   ```
   [global]
   username = "your_spotify_email"
   password = "your_spotify_password"
   device_name = "SongWall Player"
   bitrate = 320
   backend = "portaudio"  # macOS
   ```

3. Test Spotifyd: `spotifyd --no-daemon --verbose`
   - Should appear as "SongWall Player" in Spotify Connect

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

- `just start-backend` - Run backend only
- `just start-frontend` - Run frontend only
- `just install` - Install all dependencies
- `just spotifyd` - Run Spotifyd (requires config)

## Prototype Notes

- Uses JSON file for albums (albums.json)
- In-memory state for queue
- Polling for realtime updates (5s interval)
- Basic auth for admin (admin/password)
- OAuth2 PKCE for Spotify user authentication