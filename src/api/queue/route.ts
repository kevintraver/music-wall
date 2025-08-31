import { NextRequest, NextResponse } from 'next/server';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';
import { getServerTokens } from '@/lib/auth/server-tokens';

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// Rate limiting for queue operations
const endpointLimits = {
  'getMyDevices': { calls: 0, windowStart: Date.now(), limit: 5, window: 30000 },
  'addToQueue': { calls: 0, windowStart: Date.now(), limit: 5, window: 30000 }
};

function checkEndpointRateLimit(endpoint: string) {
  const now = Date.now();
  const limit = endpointLimits[endpoint as keyof typeof endpointLimits];

  if (!limit) return true;

  // Reset window if needed
  if (now - limit.windowStart >= limit.window) {
    limit.calls = 0;
    limit.windowStart = now;
  }

  // Check if we're within limits
  if (limit.calls >= limit.limit) {
    const waitTime = limit.window - (now - limit.windowStart);
    console.log(`Endpoint ${endpoint} rate limited: ${limit.calls}/${limit.limit} calls in window, wait ${waitTime}ms`);
    return waitTime;
  }

  return true;
}

function recordEndpointCall(endpoint: string) {
  const limit = endpointLimits[endpoint as keyof typeof endpointLimits];
  if (limit) {
    limit.calls++;
  }
}

export async function POST(request: NextRequest) {
  console.log('Queue request received');
  const body = await request.json().catch(() => ({} as { trackId?: string }));
  const trackId = (body as any).trackId as string | undefined;
  if (!trackId) return NextResponse.json({ error: 'Missing trackId' }, { status: 400 });

  try {
    // Proxy to WebSocket HTTP server which holds Spotify tokens
    const WS_HTTP_PORT = 3003;
    const wsRes = await fetch(`http://localhost:${WS_HTTP_PORT}/queue/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId })
    });
    const text = await wsRes.text();
    if (!wsRes.ok) {
      let err: any = {};
      try { err = JSON.parse(text); } catch {}
      return NextResponse.json(err || { error: 'Queue failed' }, { status: wsRes.status });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = (error as Error)?.message || 'Unknown error';
    console.error('Error adding to queue:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Proxy to WS HTTP server
    const WS_HTTP_PORT = 3003;
    const wsRes = await fetch(`http://localhost:${WS_HTTP_PORT}/queue`, { cache: 'no-store' as any } as any);
    const text = await wsRes.text();
    if (!wsRes.ok) {
      let err: any = {};
      try { err = JSON.parse(text); } catch {}
      return NextResponse.json(err || { error: 'Queue fetch error' }, { status: wsRes.status });
    }
    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = (error as Error)?.message || 'Queue fetch error';
    console.error('Error getting queue:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
