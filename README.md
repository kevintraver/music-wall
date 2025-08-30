# Song Wall Prototype

A web app for displaying a grid of albums with QR codes. Guests scan to queue tracks on Spotify.

## Setup

1. Install dependencies:
   - Backend: `cd backend && npm install`
   - Frontend: `cd frontend && npm install`

2. Start the backend: `cd backend && npm start`
   - Runs on http://localhost:3001

3. Start the frontend: `cd frontend && npm run dev`
   - Runs on http://localhost:3000

## Features

- Wall view: Grid of albums with QR codes
- Mobile flow: Scan QR → select track → queue
- Now Playing and Up Next bars
- Admin dashboard: Login, manage albums, control playback

## Spotify Integration

For full functionality:
- Set up Spotifyd on your laptop
- Add Spotify client ID and secret to backend/.env
- Implement OAuth flow for admin

## Prototype Notes

- Uses JSON file for albums
- In-memory state for queue
- Polling for realtime updates
- Basic auth for admin (admin/password)