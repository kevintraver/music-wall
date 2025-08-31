import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '@/lib/env';

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

  // Check if we have basic album info locally
  const localAlbum = albums.find((a: any) => a.id === albumId);

  if (localAlbum) {
    console.log(`Found local album: ${localAlbum.name}`);
    return NextResponse.json(localAlbum);
  }

  // If not found locally, return a basic response
  console.log(`Album ${albumId} not found locally`);
  return NextResponse.json({
    id: albumId,
    name: 'Unknown Album',
    artist: 'Unknown Artist',
    image: '',
    tracks: []
  });
}
