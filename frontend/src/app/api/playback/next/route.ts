import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';

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
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: 'http://127.0.0.1:3000/callback'
});

// Set access token if loaded
if (accessToken) {
  spotifyApi.setAccessToken(accessToken);
}

// Throttling for playback controls
const playbackThrottle = {
  next: { lastCall: 0, minInterval: 1000 }
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
  if (!accessToken) {
    return NextResponse.json({ error: 'Admin not authenticated with Spotify' }, { status: 401 });
  }

  if (isThrottled('next')) {
    return NextResponse.json({ error: 'Playback commands are being sent too frequently. Please wait a moment.' }, { status: 429 });
  }

  try {
    await spotifyApi.skipToNext();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error skipping:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}