import { NextRequest, NextResponse } from 'next/server';
import { generateCodeVerifier, generateCodeChallenge } from '@/lib/auth/oauth';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, assertSpotifyEnv } from '@/lib/utils/env';

export async function GET(request: NextRequest) {
  try {
    assertSpotifyEnv();

    // Force the OAuth flow to originate from the configured Spotify redirect host.
    const desired = new URL(SPOTIFY_REDIRECT_URI);
    const reqHost = request.headers.get('host') || '';
    const desiredHost = desired.port ? `${desired.hostname}:${desired.port}` : desired.hostname;
    if (reqHost !== desiredHost) {
      const absolute = new URL(request.url);
      absolute.protocol = desired.protocol;
      absolute.host = desiredHost;
      return NextResponse.redirect(absolute.toString());
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'OAuth init failed', details: message }, { status: 500 });
  }
}
