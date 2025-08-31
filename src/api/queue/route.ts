import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';

const TOKEN_FILE = path.join(process.cwd(), 'data', 'spotify-tokens.json');

// OAuth variables
let accessToken = '';
let refreshToken = '';

// Token persistence
function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      accessToken = tokens.accessToken || '';
      refreshToken = tokens.refreshToken || '';
      console.log('Loaded saved Spotify tokens');
      return true;
    }
  } catch (error) {
    console.error('Error loading saved tokens:', error);
  }
  return false;
}

function saveTokens() {
  try {
    const tokens = {
      accessToken,
      refreshToken,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    console.log('Saved Spotify tokens to file');
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

// Load saved tokens on startup
const tokensLoaded = loadTokens();

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// Set access token if loaded
if (accessToken) {
  spotifyApi.setAccessToken(accessToken);
}

// Refresh token function
async function refreshAccessToken() {
  if (!refreshToken) return;
  try {
    console.log('Refreshing Spotify access token...');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    const data = await response.json();
    if (data.access_token) {
      accessToken = data.access_token;
      if (data.refresh_token) {
        refreshToken = data.refresh_token;
      }
      spotifyApi.setAccessToken(accessToken);
      saveTokens(); // Save updated tokens
      console.log('Successfully refreshed and saved Spotify tokens');
    } else {
      console.error('Failed to refresh token:', data);
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
  }
}

// Rate limiting for queue operations
const endpointLimits = {
  'getMyDevices': { calls: 0, windowStart: Date.now(), limit: 5, window: 30000 },
  'addToQueue': { calls: 0, windowStart: Date.now(), limit: 5, window: 30000 }
};

function checkEndpointRateLimit(endpoint: string) {
  const now = Date.now();
  const limit = endpointLimits[endpoint as keyof typeof endpointLimits];

  if (!limit) return true;

  // Reset window if needed
  if (now - limit.windowStart >= limit.window) {
    limit.calls = 0;
    limit.windowStart = now;
  }

  // Check if we're within limits
  if (limit.calls >= limit.limit) {
    const waitTime = limit.window - (now - limit.windowStart);
    console.log(`Endpoint ${endpoint} rate limited: ${limit.calls}/${limit.limit} calls in window, wait ${waitTime}ms`);
    return waitTime;
  }

  return true;
}

function recordEndpointCall(endpoint: string) {
  const limit = endpointLimits[endpoint as keyof typeof endpointLimits];
  if (limit) {
    limit.calls++;
  }
}

export async function POST(request: NextRequest) {
  console.log('Queue request received');
  const headerAccess = request.headers.get('x-spotify-access-token') || '';
  if (headerAccess) {
    spotifyApi.setAccessToken(headerAccess);
  } else if (!accessToken) {
    console.log('No access token');
    return NextResponse.json({ error: 'Admin not authenticated with Spotify' }, { status: 401 });
  }

  const { trackId } = await request.json();

  try {
    // Check rate limits for queue operations
    const devicesLimit = checkEndpointRateLimit('getMyDevices');
    const queueLimit = checkEndpointRateLimit('addToQueue');

    if (devicesLimit !== true || queueLimit !== true) {
      return NextResponse.json({ error: 'Rate limited, please try again later.' }, { status: 429 });
    }

    // Get available devices
    const devices = await spotifyApi.getMyDevices();
    console.log('Devices found:', devices.body.devices.length);
    const activeDevice = devices.body.devices.find(d => d.is_active);
    console.log('Active device:', activeDevice ? activeDevice.name : 'None');

    if (!activeDevice) {
      return NextResponse.json({ error: 'No active Spotify device found. Make sure Spotify app is running and logged in.' }, { status: 400 });
    }

    // Add track to queue
    await spotifyApi.addToQueue(`spotify:track:${trackId}`, { device_id: activeDevice.id || undefined });

    // Record successful calls
    recordEndpointCall('getMyDevices');
    recordEndpointCall('addToQueue');

    console.log('Track added to queue successfully');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error adding to queue:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const headerAccess = request.headers.get('x-spotify-access-token') || '';
  if (headerAccess) {
    spotifyApi.setAccessToken(headerAccess);
  } else if (!accessToken) {
    return NextResponse.json({ error: 'Admin not authenticated with Spotify' }, { status: 401 });
  }

  try {
    // Note: Spotify API doesn't provide queue information through getMyCurrentPlaybackState
    // Queue information would need to be tracked separately or through WebSocket updates
    return NextResponse.json([]);
  } catch (error: any) {
    console.error('Error getting queue:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
