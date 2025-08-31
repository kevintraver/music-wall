import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '@/lib/utils/env';

const ALBUMS_FILE = path.join(process.cwd(), 'data', 'albums.json');

// Load albums from JSON
function loadAlbums() {
  try {
    const data = fs.readFileSync(ALBUMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading albums.json:', error);
    return [];
  }
}

let albums = loadAlbums();

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
  } catch (error) {
    console.error('Spotify client authentication failed:', error);
  }
}

// Initialize authentication
authenticateSpotify();

// Simple cache for album data
const albumCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// Rate limiting for album requests
const albumRequestTimes = new Map();
const ALBUM_REQUEST_LIMIT = 10; // Max 10 album requests per minute
const ALBUM_REQUEST_WINDOW = 60000; // 1 minute window

// Endpoint-specific rate limiting
const endpointLimits = {
  'getAlbum': { calls: 0, windowStart: Date.now(), limit: 20, window: 30000 }, // 20 calls per 30s
};

function checkEndpointRateLimit(endpoint: string) {
  const now = Date.now();
  const limit = endpointLimits[endpoint as keyof typeof endpointLimits];

  if (!limit) return true; // No limit defined for this endpoint

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

// Rate limit handling utilities
function getRetryAfterDelay(error: any) {
  if (error.statusCode === 429) {
    // Check for Retry-After header (in seconds)
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      const delay = parseInt(retryAfter) * 1000; // Convert to milliseconds
      // Add jitter (±25%) to prevent thundering herd
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      const finalDelay = Math.max(1000, delay + jitter); // Minimum 1 second
      console.log(`Rate limited: Spotify suggests waiting ${delay}ms, using ${Math.round(finalDelay)}ms with jitter`);
      return finalDelay;
    }
    // Fallback to exponential backoff with jitter if no Retry-After header
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, 0)); // Max 30 seconds
    const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1); // ±10% jitter
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
      return true; // Indicates we should retry
    }
  }
  return false; // Don't retry
}

export async function GET(request: NextRequest) {
  const clientIP = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();

  // Check rate limit
  const requestTimes = albumRequestTimes.get(clientIP) || [];
  const recentRequests = requestTimes.filter((time: number) => now - time < ALBUM_REQUEST_WINDOW);

  if (recentRequests.length >= ALBUM_REQUEST_LIMIT) {
    console.log(`Rate limit exceeded for ${clientIP}, returning cached data`);
    const cachedAlbums = [];
    for (const album of albums) {
      const cacheKey = `album_${album.id}`;
      const cached = albumCache.get(cacheKey);
      cachedAlbums.push(cached ? cached.data : album);
    }
    return NextResponse.json(cachedAlbums);
  }

  // Add this request to the tracking
  recentRequests.push(now);
  albumRequestTimes.set(clientIP, recentRequests);

  try {
    const enrichedAlbums = [];
    for (const album of albums) {
      const cacheKey = `album_${album.id}`;
      const cached = albumCache.get(cacheKey);

      // If we have a cached version and it's still fresh, use it
      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        enrichedAlbums.push(cached.data);
        continue;
      }

      // If the album already has an image from the JSON file, use it directly
      if (album.image && album.image.startsWith('http')) {
        console.log(`✅ Using local data for album "${album.name}" (no API call needed)`);
        albumCache.set(cacheKey, { data: album, timestamp: Date.now() });
        enrichedAlbums.push(album);
        continue;
      }

      // Only fetch from Spotify API if we don't have an image
      try {
        // Check rate limit for getAlbum endpoint
        const rateLimitCheck = checkEndpointRateLimit('getAlbum');
        if (rateLimitCheck !== true) {
          console.log(`Rate limited fetching album ${album.id}, using local data`);
          enrichedAlbums.push(album);
          continue;
        }

        console.log(`Fetching missing image for album ${album.id} from Spotify API`);
        const data = await spotifyApiClient.getAlbum(album.id, { market: 'US' });
        const enrichedAlbum = {
          ...album,
          image: data.body.images[0]?.url || album.image
        };

        // Record successful call
        recordEndpointCall('getAlbum');

        albumCache.set(cacheKey, { data: enrichedAlbum, timestamp: Date.now() });
        enrichedAlbums.push(enrichedAlbum);
        console.log(`Successfully cached album ${album.id} with fresh image`);

        // Add small delay between requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        if (error.statusCode === 429) {
          const shouldRetry = await handleRateLimitError(error, `album fetch for ${album.id}`);
          if (shouldRetry) {
            // Retry the operation
            try {
              const data = await spotifyApiClient.getAlbum(album.id, { market: 'US' });
              const enrichedAlbum = {
                ...album,
                image: data.body.images[0]?.url || album.image
              };
              albumCache.set(cacheKey, { data: enrichedAlbum, timestamp: Date.now() });
              enrichedAlbums.push(enrichedAlbum);
              console.log(`Successfully cached album ${album.id} with fresh image (after retry)`);
            } catch (retryError) {
              console.log(`Rate limited fetching album ${album.id}, using local data`);
              enrichedAlbums.push(album); // Use local data as fallback
            }
          } else {
            console.log(`Rate limited fetching album ${album.id}, using local data`);
            enrichedAlbums.push(album); // Use local data as fallback
          }
        } else {
          console.error(`Error fetching album ${album.id}:`, error.message);
          enrichedAlbums.push(album); // Use local data as fallback
        }
      }
    }

    // Log summary of data sources
    const localCount = enrichedAlbums.filter((album: any) => {
      const original = albums.find((a: any) => a.id === album.id);
      return original && original.image === album.image;
    }).length;

    const apiCount = enrichedAlbums.length - localCount;
    console.log(`📊 Albums served: ${localCount} from local data, ${apiCount} from Spotify API`);

    return NextResponse.json(enrichedAlbums);
  } catch (error) {
    console.error('Error in /api/albums:', error);
    return NextResponse.json(albums);
  }
}
