import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { getCodeVerifier } from '@/lib/oauth';

// OAuth variables
let accessToken = '';
let refreshToken = '';

// Token persistence
const TOKEN_FILE = path.join(process.cwd(), 'data', 'spotify-tokens.json');

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

// Spotify API setup - will be updated with correct redirect URI
let spotifyApi: SpotifyWebApi;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    const host = request.headers.get('host') || 'localhost:3000';
    const redirectUri = `http://${host}/callback`;

    // Initialize Spotify API with correct redirect URI
    spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: redirectUri
    });

    const codeVerifier = getCodeVerifier();
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID!,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    const data = await response.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    spotifyApi.setAccessToken(accessToken);
    saveTokens(); // Save tokens to file
    console.log('Successfully authenticated and saved Spotify tokens');

    // Redirect to admin page using the same hostname as the request
    return NextResponse.redirect(`http://${host}/admin`);
  } catch (error) {
    console.error('Error exchanging code:', error);
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 });
  }
}