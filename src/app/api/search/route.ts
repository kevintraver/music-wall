import { NextRequest, NextResponse } from 'next/server';
import SpotifyWebApi from 'spotify-web-api-node';

// Spotify API setup
const spotifyApiClient = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Authenticate with Spotify
async function authenticateSpotify() {
  try {
    const data = await spotifyApiClient.clientCredentialsGrant();
    spotifyApiClient.setAccessToken(data.body['access_token']);
    console.log('Spotify client authenticated successfully');
  } catch (error) {
    console.error('Spotify client authentication failed:', error);
  }
}

// Initialize authentication
authenticateSpotify();

// Rate limiting for search
const endpointLimits = {
  'searchAlbums': { calls: 0, windowStart: Date.now(), limit: 10, window: 30000 }
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json([]);
  }

  try {
    // Check rate limit for search endpoint
    const rateLimitCheck = checkEndpointRateLimit('searchAlbums');
    if (rateLimitCheck !== true) {
      console.log('Rate limited during search, returning empty results');
      return NextResponse.json([]);
    }

    const data = await spotifyApiClient.searchAlbums(query, { limit: 10, market: 'US' });
    const results = data.body.albums.items.map((album: any) => ({
      id: album.id,
      name: album.name,
      artist: album.artists[0].name,
      image: album.images[0]?.url
    }));

    // Record successful call
    recordEndpointCall('searchAlbums');

    return NextResponse.json(results);
  } catch (error: any) {
    if (error.statusCode === 429) {
      const shouldRetry = await handleRateLimitError(error, 'album search');
      if (shouldRetry) {
        // Retry the search operation
        try {
          const data = await spotifyApiClient.searchAlbums(query, { limit: 10, market: 'US' });
          const results = data.body.albums.items.map((album: any) => ({
            id: album.id,
            name: album.name,
            artist: album.artists[0].name,
            image: album.images[0]?.url
          }));
          return NextResponse.json(results);
        } catch (retryError) {
          console.log('Rate limited during search retry, returning empty results');
          return NextResponse.json([]);
        }
      } else {
        console.log('Rate limited during search, returning empty results');
        return NextResponse.json([]);
      }
    }
    console.error('Search error:', error);
    return NextResponse.json([]);
  }
}