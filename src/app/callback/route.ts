import { NextRequest, NextResponse } from 'next/server';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, APP_BASE_URL, assertSpotifyEnv } from '@/lib/utils/env';
import { setServerTokens } from '@/lib/auth/server-tokens';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    assertSpotifyEnv();

    const host = request.headers.get('host') || 'localhost:3000';

    const storedState = request.cookies.get('spotify_oauth_state')?.value || '';
    const codeVerifier = request.cookies.get('spotify_pkce_verifier')?.value || '';

    if (!state || !storedState || state !== storedState) {
      return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
    }
    if (!codeVerifier) {
      return NextResponse.json({ error: 'Missing PKCE code verifier' }, { status: 400 });
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Token exchange failed:', data);
      return NextResponse.json({ error: 'Auth failed', details: data }, { status: 500 });
    }

    const accessToken = data.access_token as string;
    const refreshToken = (data.refresh_token as string) || '';
    const expiresIn = data.expires_in as number || 3600; // Default to 1 hour
    console.log('Successfully authenticated with Spotify tokens');

    // Update tokens in this Next.js process and the WebSocket server
    try {
      setServerTokens({ accessToken, refreshToken });
      if (global.setSpotifyTokens) {
        global.setSpotifyTokens({ accessToken, refreshToken });
      }
    } catch (e) {
      console.error('Failed updating WS tokens:', e);
    }

    const baseUrl = APP_BASE_URL || `http://${host}`;
    const res = NextResponse.redirect(`${baseUrl}/callback/success?access_token=${encodeURIComponent(
      accessToken
    )}&refresh_token=${encodeURIComponent(refreshToken)}&expires_in=${expiresIn}`);
    // Clear temp cookies
    res.cookies.set('spotify_oauth_state', '', { httpOnly: true, maxAge: 0, path: '/' });
    res.cookies.set('spotify_pkce_verifier', '', { httpOnly: true, maxAge: 0, path: '/' });
    return res;
  } catch (error) {
    console.error('Error exchanging code:', error);
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 });
  }
}
