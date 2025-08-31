import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/env';

const TOKEN_FILE = path.join(process.cwd(), '.tokens', 'spotify-tokens.json');

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
      return true;
    }
  } catch (error) {
    console.error('Error loading saved tokens:', error);
  }
  return false;
}

// Load saved tokens
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

export async function GET(request: NextRequest) {
  const headerAccess = request.headers.get('x-spotify-access-token') || '';
  const headerRefresh = request.headers.get('x-spotify-refresh-token') || '';
  if (headerAccess) {
    spotifyApi.setAccessToken(headerAccess);
    // Sync tokens to WebSocket server for polling
    if (global.setSpotifyTokens) {
      global.setSpotifyTokens({ 
        accessToken: headerAccess, 
        refreshToken: headerRefresh 
      });
    }
  } else if (!accessToken) {
    return NextResponse.json({ error: 'Admin not authenticated with Spotify' }, { status: 401 });
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
