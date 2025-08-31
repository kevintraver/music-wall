import { NextRequest, NextResponse } from 'next/server';
import { setServerTokens } from '@/lib/auth/server-tokens';

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let body: any = {};
    if (contentType.includes('application/json')) {
      body = await request.json();
    }

    const headerAccess = request.headers.get('x-spotify-access-token') || '';
    const headerRefresh = request.headers.get('x-spotify-refresh-token') || '';
    const accessToken = body.accessToken || headerAccess || '';
    const refreshToken = body.refreshToken || headerRefresh || '';

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: 'Missing accessToken' }, { status: 400 });
    }

    try {
      setServerTokens({ accessToken, refreshToken });
      if (global.setSpotifyTokens) {
        global.setSpotifyTokens({ accessToken, refreshToken });
      }
    } catch (e) {
      console.error('Failed updating tokens:', e);
    }

    // No server-side persistence; tokens must live in client localStorage
    return NextResponse.json({ ok: true, storage: 'client' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Server does not store tokens; they are kept in client localStorage
    return NextResponse.json({ exists: false, storage: 'client_only' });
  } catch {
    return NextResponse.json({ exists: false, storage: 'client_only' });
  }
}
