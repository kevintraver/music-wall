import { NextRequest, NextResponse } from 'next/server';
import { generateCodeVerifier, generateCodeChallenge } from '@/lib/auth/oauth';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, assertSpotifyEnv } from '@/lib/utils/env';

export async function GET(request: NextRequest) {
  try {
    assertSpotifyEnv();

    // Normalize host to match SPOTIFY_REDIRECT_URI host so cookies are set for the same host used in callback
    const desired = new URL(SPOTIFY_REDIRECT_URI);
    const reqHost = request.headers.get('host') || '';
    // Extract hostname:port from desired
    const desiredHost = desired.port ? `${desired.hostname}:${desired.port}` : desired.hostname;
    if (reqHost !== desiredHost) {
      const url = new URL(request.url);
      url.host = desiredHost;
      // Redirect to the same path on the correct host before starting OAuth
      return NextResponse.redirect(url.toString());
    }

  // PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const scopes = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private';

  const authUrl = `https://accounts.spotify.com/authorize?client_id=${encodeURIComponent(
    SPOTIFY_CLIENT_ID
  )}&response_type=code&redirect_uri=${encodeURIComponent(
    SPOTIFY_REDIRECT_URI
  )}&code_challenge_method=S256&code_challenge=${encodeURIComponent(codeChallenge)}&scope=${encodeURIComponent(
    scopes
  )}&state=${encodeURIComponent(state)}`;

  const res = NextResponse.redirect(authUrl);
  // Store verifier and state in HttpOnly cookies
  res.cookies.set('spotify_pkce_verifier', codeVerifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60, // 10 minutes
  });
  res.cookies.set('spotify_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: 'OAuth init failed', details: e?.message || String(e) }, { status: 500 });
  }
}
