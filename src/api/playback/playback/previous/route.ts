import { NextRequest, NextResponse } from 'next/server';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// Throttling for playback controls
const playbackThrottle = {
  previous: { lastCall: 0, minInterval: 1000 }
};

function isThrottled(action: string) {
  const now = Date.now();
  const throttle = playbackThrottle[action as keyof typeof playbackThrottle];
  if (now - throttle.lastCall < throttle.minInterval) {
    return true;
  }
  throttle.lastCall = now;
  return false;
}

export async function POST(request: NextRequest) {
  const headerAccess = request.headers.get('x-spotify-access-token') || '';
  const headerRefresh = request.headers.get('x-spotify-refresh-token') || '';
  if (!headerAccess) {
    return NextResponse.json({ error: 'Admin not authenticated with Spotify' }, { status: 401 });
  }

  spotifyApi.setAccessToken(headerAccess);
  // Sync tokens to WebSocket server for polling
  if (global.setSpotifyTokens) {
    global.setSpotifyTokens({ accessToken: headerAccess, refreshToken: headerRefresh });
  }

  if (isThrottled('previous')) {
    return NextResponse.json({ error: 'Playback commands are being sent too frequently. Please wait a moment.' }, { status: 429 });
  }

  try {
    await spotifyApi.skipToPrevious();

    // Send WebSocket update to all clients (will be picked up by next polling cycle)
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        type: 'playback'
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error skipping to previous:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
