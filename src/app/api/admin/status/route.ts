import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const accessToken = request.headers.get('x-spotify-access-token') || '';
  const refreshToken = request.headers.get('x-spotify-refresh-token') || '';

  return NextResponse.json({
    authenticated: !!accessToken,
    hasRefreshToken: !!refreshToken,
    tokensLoaded: true
  });
}