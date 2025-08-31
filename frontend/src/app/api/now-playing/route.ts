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

export async function GET(request: NextRequest) {
  if (!accessToken) {
    return NextResponse.json({ error: 'Admin not authenticated with Spotify' }, { status: 401 });
  }

  try {
    const data = await spotifyApi.getMyCurrentPlayingTrack();
    if (data.body.item) {
      return NextResponse.json({
        id: data.body.item.id,
        name: data.body.item.name,
        artist: data.body.item.artists[0].name,
        album: data.body.item.album.name,
        image: data.body.item.album.images[0]?.url
      });
    } else {
      return NextResponse.json(null);
    }
  } catch (error: any) {
    console.error('Error getting now playing:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}