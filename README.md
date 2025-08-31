This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Configure Spotify OAuth (exact redirect URI)

- Create a Spotify app at https://developer.spotify.com/dashboard.
- Add Redirect URIs that exactly match what your app will use (e.g. `http://localhost:3000/callback` and/or `http://127.0.0.1:3000/callback`). Save.
- Copy `.env.example` to `.env` and fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, set `SPOTIFY_REDIRECT_URI` to one of the registered values, and optionally `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
- If you prefer the app to run on `http://localhost:3000` while the Spotify redirect uses `127.0.0.1`, set `APP_BASE_URL=http://localhost:3000`. The callback exchanges tokens on the Spotify host and then redirects to `APP_BASE_URL` for `/callback/success`.
- The `SPOTIFY_REDIRECT_URI` must match character-for-character (scheme, host, port, path, no trailing slash) in both the authorize URL and the token exchange.

### Album Data Storage

The app now uses **localStorage** for album management instead of JSON files:

- **Default albums**: Loaded from `data/albums.example.json` on first use
- **User albums**: Stored in browser localStorage (not committed to git)
- **Real-time sync**: All album changes sync instantly across all connected clients
- **No server persistence**: Albums are stored client-side for simplicity

The `data/albums.example.json` file provides starter content but is not used for ongoing storage.

### Album Management

- **Add Albums**: Search for albums in the admin panel and click the add button
- **Reorder Albums**: Drag and drop albums to change their order in the wall
- **Delete Albums**: Click the delete button (🗑️) on any album in the admin panel
- **Data Storage**: All albums are stored in browser localStorage
- **Real-time Sync**: Changes sync instantly to all connected clients via WebSocket
- **No Persistence**: Albums are stored client-side only (refreshing will reset to defaults)

Admin login redirects to Spotify to grant access. Tokens are stored client-side for the admin dashboard and used by server routes for playback/queue.

### WebSocket Server

The app uses a separate WebSocket server for real-time updates. Start it alongside the Next.js app:

```bash
# Start both servers (recommended)
just start-all

# Or start individually
npm run dev          # Next.js app
npm run ws           # WebSocket server
```

The WebSocket server polls Spotify for updates and broadcasts them to all connected clients.

### Performance Configuration

You can customize polling intervals and rate limiting through environment variables:

```bash
# Server-side polling (WebSocket server)
WS_POLLING_INTERVAL=2000          # How often to poll Spotify (default: 2000ms)
MIN_API_INTERVAL=500              # Minimum time between API calls (default: 500ms)
ENDPOINT_RATE_LIMIT=20            # API calls per time window (default: 20)
ENDPOINT_RATE_WINDOW=5000         # Time window for rate limiting (default: 5000ms)

# Client-side polling (fallback when WebSocket fails)
NEXT_PUBLIC_QUEUE_POLLING_INTERVAL=3000   # Queue polling interval (default: 3000ms)
NEXT_PUBLIC_ALBUMS_POLLING_INTERVAL=2000  # Albums polling interval (default: 2000ms)
```

Lower values provide faster updates but may hit Spotify's rate limits. Higher values reduce API usage but increase update delays.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
