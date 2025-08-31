import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

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

    const tokenDir = path.join(process.cwd(), 'data');
    const tokenFile = path.join(tokenDir, 'spotify-tokens.json');
    try {
      if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });
      fs.writeFileSync(
        tokenFile,
        JSON.stringify({ accessToken, refreshToken, savedAt: new Date().toISOString() }, null, 2)
      );
    } catch (e) {
      console.error('Failed writing token file:', e);
    }

    try {
      if (global.setSpotifyTokens) {
        global.setSpotifyTokens({ accessToken, refreshToken });
      }
    } catch (e) {
      console.error('Failed updating WS tokens:', e);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const tokenFile = path.join(process.cwd(), 'data', 'spotify-tokens.json');
    const exists = fs.existsSync(tokenFile);
    return NextResponse.json({ exists });
  } catch {
    return NextResponse.json({ exists: false });
  }
}

