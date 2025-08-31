import { NextRequest, NextResponse } from 'next/server';
import { generateCodeVerifier, generateCodeChallenge, setCodeVerifier } from '@/lib/oauth';

export async function GET(request: NextRequest) {
  const codeVerifier = generateCodeVerifier();
  setCodeVerifier(codeVerifier);
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const scopes = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private';
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${process.env.SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent('http://127.0.0.1:3000/callback')}&code_challenge_method=S256&code_challenge=${codeChallenge}&scope=${encodeURIComponent(scopes)}`;

  return NextResponse.redirect(authUrl);
}