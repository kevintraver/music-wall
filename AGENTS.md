# AGENTS.md

This file provides comprehensive guidance for AI agents (including Claude Code) when working with code in this repository.

## Application Overview

This is a **real-time music wall application** that creates an interactive display for music discovery and playback. The application consists of:

- **Public Music Wall**: A visual display showing album artwork in a grid layout, designed for public spaces like cafes, offices, or events
- **Admin Dashboard**: A Spotify-authenticated interface for managing the music collection and controlling playback
- **Real-time Synchronization**: WebSocket-powered updates that keep all connected displays in sync
- **QR Code Integration**: Album pages with QR codes for easy track queueing (future feature)

The app integrates with Spotify's API to provide seamless music playback and uses a dual-server architecture to handle both the web interface and real-time communication efficiently.

## Common Commands

### Development
- `npm run dev` - Start development server (Next.js with Turbopack + custom server.js)
- `npm run build` - Build production bundle with Turbopack
- `npm run start` - Start production server
- `npm run lint` - Run ESLint (Next.js + TypeScript rules)

### WebSocket Server
- `npm run ws` - Start WebSocket server using tsx
- `just start-all` - Start both app and WebSocket server via justfile/pm2
- `just stop` - Stop all processes
- `just restart` - Restart all processes

### Maintenance Scripts
- `npm run update-album-art` - Update album artwork from Spotify API
- `npm run update-default-tracks` - Update default track data

### Testing & Quality
- Run `npm run lint` before committing changes
- No test framework configured - use Jest + Testing Library if adding tests

## Architecture Overview

### High-Level Structure
This is a **dual-server architecture** for a real-time music wall application:

1. **Next.js App (port 3000)**: Public wall display, admin dashboard, and API routes
2. **WebSocket Server (port 3002)**: Real-time synchronization between clients, Spotify API polling
3. **HTTP Bridge (port 3003)**: Inter-process communication between Next.js and WebSocket server

### Key Architectural Patterns

#### Real-Time Data Flow
- **WebSocket Server** polls Spotify API every 2 seconds for playback/queue updates
- **Global functions** (`global.sendWebSocketUpdate`, `global.setSpotifyTokens`) bridge Next.js API routes to WebSocket server
- **State Context** (`useAppState`) manages client-side state with WebSocket message handling
- **Token Management** happens client-side (localStorage) and syncs to WebSocket server via API calls

#### Data Storage Strategy
- **Albums**: Stored in localStorage, synced via WebSocket broadcasts (no file persistence)
- **Auth Tokens**: Client-side localStorage, forwarded to WebSocket server for API calls
- **Default Data**: Seeded from `data/albums.example.json`, maintained by update scripts

#### Client Architecture
- **Main Wall (`/`)**: Public display, WebSocket-only (no API calls), auto-reconnection
- **Admin Dashboard (`/admin`)**: Authenticated, makes API calls + WebSocket connection
- **Album Pages (`/album/[id]`)**: QR code destinations for track queueing (future implementation)

### Directory Structure
```
src/
├── app/                    # Next.js app router
│   ├── api/               # API routes (admin, playback, albums, etc.)
│   ├── admin/             # Admin dashboard page
│   └── album/[id]/        # Album detail pages
├── components/
│   ├── admin/             # Admin-specific components
│   ├── shared/            # Reusable UI components
│   └── wall/              # Public wall components
├── lib/
│   ├── auth/              # OAuth, token management
│   ├── spotify/           # Spotify API utilities
│   └── utils/             # State context, localStorage, logger
├── websocket/             # WebSocket server implementation
└── scripts/               # Maintenance scripts
```

### Critical Integration Points

#### WebSocket Message Types
- `albums`: Album list updates from admin actions
- `playback`: Now playing + queue updates from Spotify polling
- `auth`: Admin authentication with token sync
- `admin_stats`: Server statistics for admin dashboard

#### API Route Patterns
- Admin routes require token headers (`x-spotify-access-token`, `x-spotify-refresh-token`)
- All admin actions call `global.sendWebSocketUpdate()` to broadcast changes
- Token sync happens via `global.setSpotifyTokens()` in auth routes

#### State Management
- React Context (`useAppState`) with reducer pattern for complex state
- WebSocket reconnection with exponential backoff (10 attempts max)
- Loading states managed granularly (albums, playback, queue)

## Development Guidelines

### Environment Setup
- Copy `.env.example` to `.env` and configure Spotify OAuth credentials
- Spotify redirect URI must match exactly (no trailing slash)
- Set `APP_BASE_URL` if frontend and OAuth hosts differ

### Project Structure & Module Organization
- Next.js route hierarchy is under `src/app`; pages and layouts use app router conventions with co-located loading/error files when needed.
- Shared UI sits in `src/components`, split by feature to keep imports lean.
- API helpers and domain logic live in `src/lib` (auth, spotify, utils), while real-time handlers are in `src/websocket`.
- Public assets (images, fonts) belong in `public/`; sample data for bootstrapping lives in `data/`.
- Scripts for maintenance tasks reside in `scripts/` and should encapsulate all filesystem writes.

### Code Conventions
- **TypeScript**: Strict mode enabled, explicit types for parameters/returns
- **Imports**: Use `@/` alias, group by React/Next.js → external → internal
- **Components**: PascalCase filenames, functional components with hooks
- **API Routes**: Export named HTTP methods (GET, POST, etc.), return NextResponse.json()
- **Error Handling**: Never log sensitive data (tokens, credentials)

### Coding Style & Naming Conventions
- TypeScript operates in `strict` mode; always type parameters and returns, and prefer interfaces for objects.
- Use absolute imports with the `@/` alias and group by origin (framework, external, internal).
- Components and types use PascalCase, variables use camelCase, route files stay kebab-case.
- Tailwind CSS drives styling; keep class lists semantic and mobile-first, adding dark-mode variants when relevant.

### WebSocket Development
- WebSocket server runs independently - start it with `npm run ws`
- Client connections handle reconnection automatically
- Test WebSocket messages in browser DevTools console
- Debug polling with `WS_POLLING_INTERVAL` environment variable
- Override the browser WebSocket endpoint with `NEXT_PUBLIC_WS_URL` when exposing the app over tunnels like ngrok; otherwise the client falls back to `ws://<hostname>:NEXT_PUBLIC_WS_PORT` (default `3002`).
- QR code generation resolves `APP_BASE_URL` (falling back to the incoming request host) so ensure it is set when tunnelling.
- Spotify OAuth always flows through the configured redirect host (e.g., localhost), so only that URI needs to be whitelisted when using tunnels.

### Spotify Integration
- All Spotify API calls happen server-side (WebSocket server or API routes)
- Tokens flow: Admin login → localStorage → API headers → WebSocket server
- Rate limiting and token refresh handled automatically
- Queue operations require active Spotify device

### Common Patterns

#### Adding New Admin Features
1. Create API route in `src/app/api/admin/`
2. Extract tokens from headers, validate authentication
3. Make Spotify API calls as needed
4. Call `global.sendWebSocketUpdate()` to broadcast changes
5. Add corresponding WebSocket message handler for real-time updates

#### Adding New WebSocket Message Types
1. Update `src/websocket/types.ts` with new message interface
2. Add handler in `src/websocket/message-handlers.ts`
3. Update client message processing in `src/lib/utils/state-context.tsx`
4. Add corresponding reducer actions if state updates needed

#### Album Management Flow
1. Admin searches albums via `/api/search` (client credentials)
2. Albums stored in localStorage via admin actions
3. Changes broadcast via `global.sendWebSocketUpdate({ type: 'albums', albums: [...] })`
4. All clients receive updates and sync their localStorage

## Testing Guidelines
- No test harness ships today; favour Jest + Testing Library for components and `ts-node` friendly suites for utilities.
- Place future tests beside the implementation (`Component.test.tsx`, `utils.spec.ts`) and keep fixtures in `data/`.
- Before submitting, at minimum run lint and any added test scripts; document manual QA steps in the PR.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat: add album wall autoplay`) and focus messages on intent.
- Each PR should describe scope, link tracking issues, and attach screenshots or clips for UI shifts.
- Call out configuration changes (env vars, secrets) explicitly and note any follow-up tasks.

## Security & Configuration Tips
- Load secrets through `.env.local` and never commit the file; `dotenv` powers both app and scripts.
- Avoid logging tokens or Spotify payloads; prefer structured error messages with context but no sensitive fields.
- Never commit `.env` files or log tokens/credentials
- Admin authentication uses Spotify OAuth (no separate user system)
- QR codes are generated dynamically (no sensitive data embedded)
- CORS and rate limiting should be added for production deployment
