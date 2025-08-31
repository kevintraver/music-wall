import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth/middleware';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// GET /api/admin/status - Check admin authentication and Spotify connection status
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    // Read tokens from headers supplied by the client
    const accessToken = request.headers.get('x-spotify-access-token') || '';
    const refreshToken = request.headers.get('x-spotify-refresh-token') || '';

    const status: any = {
      authenticated: !!accessToken,
      hasRefreshToken: !!refreshToken,
      spotifyApiConfigured: !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
      timestamp: new Date().toISOString()
    };

    // Test Spotify API connection if we have tokens
    if (accessToken) {
      try {
        spotifyApi.setAccessToken(accessToken);
        const me = await spotifyApi.getMe();
        status.spotifyConnected = true;
        status.user = {
          id: me.body.id,
          displayName: me.body.display_name,
          email: me.body.email
        };

        // Try to get current playback
        try {
          const playback = await spotifyApi.getMyCurrentPlaybackState();
          status.currentPlayback = {
            isPlaying: playback.body?.is_playing || false,
            device: playback.body?.device ? {
              name: playback.body.device.name,
              type: playback.body.device.type,
              isActive: playback.body.device.is_active
            } : null,
            track: playback.body?.item ? {
              name: (playback.body.item as any).name,
              artist: (playback.body.item as any).artists?.[0]?.name,
              album: (playback.body.item as any).album?.name
            } : null
          };
        } catch (playbackError: any) {
          console.log('Could not get current playback:', playbackError.message);
          status.currentPlayback = { error: 'Could not fetch playback state' };
        }

      } catch (spotifyError: any) {
        console.error('Spotify API test failed:', spotifyError.message);
        status.spotifyConnected = false;
        status.spotifyError = spotifyError.message;
        status.spotifyStatusCode = spotifyError.statusCode;
      }
    }

    return NextResponse.json(status);
  } catch (error: any) {
    console.error('Admin status check error:', error);
    return NextResponse.json(
      {
        authenticated: false,
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
});
