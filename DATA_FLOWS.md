# Song Wall Data Flows

This document outlines how data flows through the Song Wall application for different user interactions and system components.

## Overview

The application has three main components:
- **WebSocket Server**: Polls Spotify APIs and broadcasts updates to all clients
- **Admin Dashboard**: Controls playback and manages albums, requires authentication
- **Main Wall**: Public display showing current albums and Now Playing info
- **Queue Interface**: (Future) User interface for queueing songs via QR codes

## Token Management

### Admin Authentication Flow
1. Admin logs in via `/login` → redirected to Spotify OAuth
2. Spotify callback stores tokens in `localStorage` (client-side)
3. Admin dashboard reads tokens from `localStorage`
4. All admin API requests send tokens via headers:
   - `x-spotify-access-token`
   - `x-spotify-refresh-token`

### Token Sync to WebSocket Server
1. Admin makes API request → tokens sent in headers
2. API routes call `global.setSpotifyTokens()` to sync tokens to WebSocket server
3. WebSocket server stores tokens and starts polling Spotify
4. WebSocket server can refresh tokens automatically using saved refresh token

## Data Flows by Feature

### 1. Now Playing Updates

**Primary Flow: WebSocket Server Polling**
- **Trigger**: Automatic interval (every 2 seconds)
- **Method**: WebSocket broadcast
- **Data Source**: Spotify API polling by WebSocket server

```
WebSocket Server → Spotify API (getMyCurrentPlayingTrack, getMyCurrentPlaybackState)
                → Processes response
                → Broadcasts to all clients: { type: 'playback', nowPlaying: {...}, isPlaying: boolean }
                
Admin Dashboard ← WebSocket message → Updates UI state
Main Wall ← WebSocket message → Updates UI state
```

**Secondary Flow: Admin Playback Controls**
- **Trigger**: Admin clicks play/pause/next/previous
- **Method**: API call + WebSocket broadcast
- **Data Source**: Admin action

```
Admin Dashboard → API call with tokens in headers (/api/playback/play, /pause, /next, /previous)
                → API route calls Spotify API
                → API route calls global.sendWebSocketUpdate()
                → Broadcast to all clients: { type: 'playback', isPlaying: boolean }
                
Admin Dashboard ← WebSocket message → Updates UI state  
Main Wall ← WebSocket message → Updates UI state
```

### 2. Queue Management

**Current Implementation:**
- Queue display only (no add/remove functionality implemented)
- Data flows same as Now Playing (WebSocket polling)

**Future Implementation for User Queue Interface:**
```
User (via QR) → Queue Interface → API call (/api/queue/add)
             → API route calls Spotify API (add to queue)
             → API route calls global.sendWebSocketUpdate()
             → Broadcast: { type: 'playback', queue: [...] }
             
All Clients ← WebSocket message → Update queue display
```

### 3. Album Management

**Admin Adding/Removing Albums:**
- **Trigger**: Admin searches and adds/removes albums
- **Method**: localStorage + WebSocket broadcast
- **Data Source**: Admin actions + Spotify search

```
Admin Dashboard → Search: API call (/api/search) → Spotify API (client credentials)
                → Add Album: Update localStorage directly
                → Call global.sendWebSocketUpdate()
                → Broadcast: { type: 'albums', albums: [...] }
                
Main Wall ← WebSocket message → Updates album grid
```

**Album Reordering:**
- **Method**: Drag & drop in admin → localStorage + WebSocket broadcast

```
Admin Dashboard → Drag & drop → Update localStorage
                → Call global.sendWebSocketUpdate()
                → Broadcast: { type: 'albums', albums: [...] }
                
Main Wall ← WebSocket message → Updates album positions
```

### 4. QR Code Generation

**Static Generation:**
- **Trigger**: Album display
- **Method**: API call per album
- **Data Source**: Album ID

```
Client → API call (/api/qr/[albumId]) → Generate QR code → Return QR data URL
```

## WebSocket Message Types

### Playback Messages
```typescript
{
  type: 'playback',
  nowPlaying: {
    id: string,
    name: string,
    artist: string,
    album: string,
    image: string
  } | null,
  isPlaying: boolean,
  queue: Array<{
    name: string,
    artist: string,
    image?: string
  }>
}
```

### Album Messages
```typescript
{
  type: 'albums',
  albums: Array<{
    id: string,
    name: string,
    artist: string,
    image: string,
    position: number
  }>
}
```

### Heartbeat Messages
```typescript
// Client to Server
{ type: 'ping' }

// Server to Client  
{ type: 'pong' }

// Client to Server (force refresh)
{ type: 'refresh' }
```

## Client Connection Flows

### Main Wall Connection (`/` - Public Display)
**Purpose**: Public-facing display showing album grid and current Now Playing info

**Connection Flow:**
1. Page loads → connects to WebSocket server (`ws://hostname:3002`)
2. On WebSocket open:
   - Sets connection status to connected
   - Sends `{ type: 'refresh' }` to request fresh snapshot
   - Starts 30-second heartbeat interval
3. Server responds with initial snapshots:
   - Albums snapshot: `{ type: 'albums', albums: [...] }`
   - Last playback snapshot: `{ type: 'playback', nowPlaying: {...}, isPlaying: boolean, queue: [...] }`
4. Continuous real-time updates via WebSocket messages

**Data Sources:**
- **Albums**: localStorage (synced from admin) → WebSocket broadcast
- **Now Playing**: Spotify API polling by WebSocket server → WebSocket broadcast
- **Queue**: Spotify API polling by WebSocket server → WebSocket broadcast

**Message Handling:**
```typescript
// Albums-only updates (from admin album management)
{ type: 'albums', albums: [...] } → Update album grid

// Playback-only updates (from Spotify polling or admin controls)
{ 
  type: 'playback', 
  nowPlaying: {...} | null,
  isPlaying: boolean,
  queue: [...]
} → Update Now Playing display and queue preview

// Mixed updates (legacy fallback)
{ type: 'mixed', albums: [...], nowPlaying: {...}, queue: [...] }
```

**UI State Management:**
- `albums`: Album grid display
- `nowPlaying`: Current track info (image, name, artist)
- `upNext`: First item from queue array for "Up Next" display
- `playbackLoaded`: Controls skeleton loading states
- `albumsLoading`: Controls album grid loading state

**Error Handling:**
- Auto-reconnection with exponential backoff (up to 10 attempts)
- Heartbeat monitoring to detect connection issues
- Graceful fallback to loading states on connection loss
- **Never handles authentication or makes API calls**

### Admin Dashboard Connection  
1. Checks authentication status via `/api/admin/status`
2. Connects to WebSocket server if authenticated
3. Receives initial snapshots
4. Makes authenticated API calls for playback control and search
5. **Handles tokens via localStorage and request headers**

### Future Queue Interface Connection
1. User scans QR code → navigates to queue interface
2. Connects to WebSocket server for real-time queue updates
3. Makes unauthenticated API calls to add songs to queue
4. **Backend handles authentication for Spotify queue modifications**

## Error Handling & Resilience

### WebSocket Server
- **Circuit breaker**: Stops polling after 5 consecutive failures
- **Rate limiting**: Respects Spotify API rate limits
- **Token refresh**: Automatically refreshes expired tokens
- **Retry logic**: Exponential backoff on errors

### Client Reconnection
- **Auto-reconnect**: Clients automatically reconnect with exponential backoff
- **State recovery**: Server sends last known state on reconnection
- **Heartbeat**: 30-second ping/pong to detect connection issues

## Current Issues & Debugging

### Now Playing Not Updating
**Potential Issues:**
1. WebSocket server has no tokens (check console for "No access token available")
2. WebSocket server not polling (check interval logs)
3. Spotify API returning no current track
4. Client not receiving WebSocket messages
5. Client not processing WebSocket messages correctly

**Debug Steps:**
1. Check WebSocket server console for polling logs
2. Verify tokens are being synced from admin API calls
3. Check browser console for WebSocket connection status
4. Verify admin dashboard shows "Connected" status
5. Test manual refresh via WebSocket `{ type: 'refresh' }` message