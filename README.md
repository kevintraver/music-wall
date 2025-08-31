Song Wall is a Next.js app that lets guests queue tracks to a shared Spotify session while an admin curates a wall of albums. A lightweight WebSocket server powers real‑time updates.

## Getting Started

Development commands:

```bash
# Next.js app (port 3000)
npm run dev

# WebSocket server (port 3002, HTTP bridge on 3003)
npm run ws

# Start both via justfile helpers
just start-all   # start app + WS
just stop        # stop all
```

Open http://localhost:3000 to view the app.

### Configure Spotify OAuth (exact redirect URI)

- Create a Spotify app at https://developer.spotify.com/dashboard.
- Add Redirect URIs that exactly match what your app will use (e.g. `http://localhost:3000/callback` and/or `http://127.0.0.1:3000/callback`). Save.
- Copy `.env.example` to `.env` and fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, set `SPOTIFY_REDIRECT_URI` to one of the registered values, and optionally `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
- If you prefer the app to run on `http://localhost:3000` while the Spotify redirect uses `127.0.0.1`, set `APP_BASE_URL=http://localhost:3000`. The callback exchanges tokens on the Spotify host and then redirects to `APP_BASE_URL` for `/callback/success`.
- The `SPOTIFY_REDIRECT_URI` must match character-for-character (scheme, host, port, path, no trailing slash) in both the authorize URL and the token exchange.

### Album Data Model (localStorage)

- Albums live entirely in the browser’s localStorage under the key `songwall_albums`.
- First load seeds from `/api/albums/default` (backed by `data/albums.example.json`).
- Admin changes are broadcast to all clients via `/api/admin/albums/sync` and persisted to each client’s localStorage.
- The WS server keeps an in‑memory snapshot of the latest albums and sends it to new clients on connect. No JSON file reads/writes are used at runtime.

Notes:
- The `data/albums.example.json` file is only for seeding defaults and for the artwork update script; it is not read for ongoing storage.
- Legacy file‑backed admin endpoints were removed and now return 410 Gone.

### Updating Default Album Art

Keep album artwork fresh with the Spotify API:

```bash
# Update all default albums with latest artwork from Spotify
npm run update-album-art
```

This script:
- Fetches album data from Spotify
- Updates `data/albums.example.json` in place
- Handles rate limiting and auth

### Album Management

- Add, reorder, and delete albums in the Admin page; changes sync to all clients via WebSocket and are saved to each client’s localStorage.
- Tracks for an album are fetched from Spotify on demand by the client if missing, then saved back to localStorage.
- Admin login redirects to Spotify; tokens are stored client‑side and forwarded to the WS/API for playback and queue operations.

If a scanned album ID isn’t in localStorage yet, the album page now waits briefly for the WS snapshot and auto‑resolves once received.

### WebSocket Server

The app uses a separate WebSocket server for real-time updates. Start it alongside the Next.js app:

```bash
# Start both servers (recommended)
just start-all

# Or start individually
npm run dev          # Next.js app
npm run ws           # WebSocket server
```

The WS server polls Spotify for playback and queue updates and broadcasts them. It also keeps an in‑memory albums snapshot that is sent to new clients on connect.

Environment knobs:

```bash
WS_POLLING_INTERVAL=2000    # ms between Spotify polling
```

### API Summary

- `GET /api/album/[id]`: Fetch album metadata + tracks from Spotify (no file reads).
- `GET /api/albums`: Deprecated; returns an empty list.
- `GET /api/albums/default`: Returns default album list for seeding localStorage.
- `POST /api/admin/albums/sync`: Broadcast a full albums array to all clients (used by Admin). No persistence.
- Legacy admin album routes now return 410 Gone.

### Queueing

- `POST /api/queue { trackId }`: Queues a track using WS server tokens; broadcasts queue update.
- `GET /api/queue`: Returns the current queue (via WS HTTP bridge).
