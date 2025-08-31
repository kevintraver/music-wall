import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, withRateLimit } from '@/lib/auth/middleware';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// Throttling for playback controls to prevent spam
const playbackThrottle = new Map<string, number>();
const THROTTLE_INTERVAL = 1000; // 1 second between commands

function isThrottled(action: string): boolean {
  const now = Date.now();
  const lastCall = playbackThrottle.get(action) || 0;

  if (now - lastCall < THROTTLE_INTERVAL) {
    return true;
  }

  playbackThrottle.set(action, now);
  return false;
}

// POST /api/playback/playback/play - Start/resume playback
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    if (isThrottled('play')) {
      return NextResponse.json(
        { error: 'Playback commands are being sent too frequently. Please wait a moment.' },
        { status: 429 }
      );
    }

    try {
      // Prefer tokens provided by client via headers
      const headerAccess = request.headers.get('x-spotify-access-token') || '';
      const headerRefresh = request.headers.get('x-spotify-refresh-token') || '';

      if (headerAccess) {
        spotifyApi.setAccessToken(headerAccess);
      }

      // Sync tokens to WebSocket server for polling
      if (global.setSpotifyTokens) {
        global.setSpotifyTokens({
          accessToken: headerAccess,
          refreshToken: headerRefresh
        });
      }

      // Get available devices
      const devices = await spotifyApi.getMyDevices();
      const activeDevice = devices.body.devices.find((d: any) => d.is_active);

      if (!activeDevice) {
        return NextResponse.json(
          { error: 'No active Spotify device found. Make sure Spotify is running and logged in.' },
          { status: 400 }
        );
      }

      // Start playback
      await spotifyApi.play({ device_id: activeDevice.id || undefined });

      // Broadcast update via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({
          type: 'playback',
          payload: { isPlaying: true }
        });
      }

      console.log(`▶️  Playback started on device: ${activeDevice.name}`);

      return NextResponse.json({
        success: true,
        message: 'Playback started',
        device: {
          name: activeDevice.name,
          type: activeDevice.type
        }
      });

    } catch (error: any) {
      console.error('❌ Error starting playback:', error);

      // Handle specific Spotify API errors
      if (error.statusCode === 403) {
        return NextResponse.json(
          { error: 'Playback control not allowed. Check your Spotify Premium status.' },
          { status: 403 }
        );
      }

      if (error.statusCode === 404) {
        return NextResponse.json(
          { error: 'No active device found or playback context unavailable.' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: error.message || 'Failed to start playback' },
        { status: 500 }
      );
    }
  })
);
