import { NextRequest, NextResponse } from 'next/server';
import SpotifyWebApi from 'spotify-web-api-node';
import { getCodeVerifier } from '@/lib/oauth';

// OAuth variables
let accessToken = '';
let refreshToken = '';

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

    // Initialize Spotify API with consistent redirect URI
    spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: 'http://localhost:3000/callback'
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
    console.log('Successfully authenticated with Spotify tokens');

    // Redirect to a callback page that will store tokens in localStorage
    return NextResponse.redirect(`http://${host}/callback/success?access_token=${accessToken}&refresh_token=${refreshToken || ''}`);
  } catch (error) {
    console.error('Error exchanging code:', error);
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 });
  }
}