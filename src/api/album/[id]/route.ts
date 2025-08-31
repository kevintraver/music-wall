import { NextRequest, NextResponse } from 'next/server';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '@/lib/utils/env';

// Spotify API setup
const spotifyApiClient = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET
});

// Authenticate with Spotify
async function authenticateSpotify() {
  try {
    const data = await spotifyApiClient.clientCredentialsGrant();
    spotifyApiClient.setAccessToken(data.body['access_token']);
    console.log('Spotify client authenticated successfully');
    return true;
  } catch (error) {
    console.error('Spotify client authentication failed:', error);
    return false;
  }
}

// Initialize authentication
let isAuthenticated = false;
authenticateSpotify().then(success => {
  isAuthenticated = success;
});

// Cache for album data
const albumCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// Rate limiting for album requests
const albumRequestTimes = new Map();
const ALBUM_REQUEST_LIMIT = 10; // Max 10 album requests per minute
const ALBUM_REQUEST_WINDOW = 60000; // 1 minute window

// Endpoint-specific rate limiting
const endpointLimits = {
  'getAlbum': { calls: 0, windowStart: Date.now(), limit: 20, window: 30000 },
  'getAlbumTracks': { calls: 0, windowStart: Date.now(), limit: 20, window: 30000 },
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

function getRetryAfterDelay(error: any) {
  if (error.statusCode === 429) {
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      const delay = parseInt(retryAfter) * 1000;
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      const finalDelay = Math.max(1000, delay + jitter);
      console.log(`Rate limited: Spotify suggests waiting ${delay}ms, using ${Math.round(finalDelay)}ms with jitter`);
      return finalDelay;
    }
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, 0));
    const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(1000, baseDelay + jitter);
    console.log(`Rate limited: Using exponential backoff ${Math.round(finalDelay)}ms with jitter`);
    return finalDelay;
  }
  return 0;
}

async function handleRateLimitError(error: any, operation: string) {
  if (error.statusCode === 429) {
    const delay = getRetryAfterDelay(error);
    if (delay > 0) {
      console.log(`Rate limited during ${operation}, waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return true;
    }
  }
  return false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: albumId } = await params;

  console.log(`Album API called for ID: ${albumId}`);

  // Ensure Spotify auth
  if (!isAuthenticated) {
    try {
      isAuthenticated = await authenticateSpotify();
    } catch {}
  }

  try {
    // Fetch album metadata
    const albumRate = checkEndpointRateLimit('getAlbum');
    if (albumRate !== true) {
      console.log(`Rate limited for getAlbum, skipping external call`);
    }

    const albumData = await spotifyApiClient.getAlbum(albumId, { market: 'US' });
    recordEndpointCall('getAlbum');

    // Fetch all tracks (paginate if necessary)
    const tracks: any[] = [];
    let offset = 0;
    const limit = 50;
    while (true) {
      const trackRate = checkEndpointRateLimit('getAlbumTracks');
      if (trackRate !== true) {
        console.log(`Rate limited for getAlbumTracks, stopping pagination at offset ${offset}`);
        break;
      }
      const t = await spotifyApiClient.getAlbumTracks(albumId, { limit, offset, market: 'US' });
      recordEndpointCall('getAlbumTracks');
      const items = (t.body.items || []) as any[];
      tracks.push(...items);
      if (!t.body.next || items.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 150));
    }

    const normalizedTracks = tracks.map((n: any) => ({
      id: n?.id,
      name: n?.name,
      duration_ms: n?.duration_ms ?? 0,
      artist: n?.artists?.[0]?.name,
      image: albumData.body.images?.[0]?.url || n?.album?.images?.[0]?.url || '',
    }));

    const response = {
      id: albumData.body.id,
      name: albumData.body.name,
      artist: albumData.body.artists?.[0]?.name || 'Unknown Artist',
      image: albumData.body.images?.[0]?.url || '',
      position: 0,
      tracks: normalizedTracks,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    // Handle rate limit with single retry
    const shouldRetry = await handleRateLimitError(error, `album+tracks fetch for ${albumId}`);
    if (shouldRetry) {
      try {
        const albumData = await spotifyApiClient.getAlbum(albumId, { market: 'US' });
        const t = await spotifyApiClient.getAlbumTracks(albumId, { limit: 50, offset: 0, market: 'US' });
        const items = (t.body.items || []) as any[];
        const normalizedTracks = items.map((n: any) => ({
          id: n?.id,
          name: n?.name,
          duration_ms: n?.duration_ms ?? 0,
          artist: n?.artists?.[0]?.name,
          image: albumData.body.images?.[0]?.url || n?.album?.images?.[0]?.url || '',
        }));
        const response = {
          id: albumData.body.id,
          name: albumData.body.name,
          artist: albumData.body.artists?.[0]?.name || 'Unknown Artist',
          image: albumData.body.images?.[0]?.url || '',
          position: 0,
          tracks: normalizedTracks,
        };
        return NextResponse.json(response);
      } catch (retryError) {
        console.warn('Retry failed for album fetch:', (retryError as any)?.message);
      }
    }

    console.error('Error fetching album/tracks:', { message: error?.message, statusCode: error?.statusCode });
    return NextResponse.json({
      id: albumId,
      name: 'Unknown Album',
      artist: 'Unknown Artist',
      image: '',
      tracks: []
    });
  }
}
