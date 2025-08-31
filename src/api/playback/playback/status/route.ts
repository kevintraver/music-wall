import { NextRequest, NextResponse } from 'next/server';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

export async function GET(request: NextRequest) {
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

  try {
    const data = await spotifyApi.getMyCurrentPlaybackState();
    return NextResponse.json({
      isPlaying: data.body?.is_playing || false
    });
  } catch (error: any) {
    console.error('Error getting playback status:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
