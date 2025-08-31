import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';

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
  { params }: { params: { id: string } }
) {
  const albumId = params.id;
  const clientIP = request.ip || 'unknown';
  const now = Date.now();

  // Check rate limit for individual album requests
  const requestTimes = albumRequestTimes.get(clientIP) || [];
  const recentRequests = requestTimes.filter((time: number) => now - time < ALBUM_REQUEST_WINDOW);

  if (recentRequests.length >= ALBUM_REQUEST_LIMIT) {
    console.log(`Rate limit exceeded for ${clientIP} on album ${albumId}`);
    const cacheKey = `album_tracks_${albumId}`;
    const cached = albumCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached.data);
    } else {
      const album = albums.find((a: any) => a.id === albumId);
      return NextResponse.json(album || { error: 'Album not found' });
    }
  }

  // Add this request to the tracking
  recentRequests.push(now);
  albumRequestTimes.set(clientIP, recentRequests);

  const cacheKey = `album_tracks_${albumId}`;
  const cached = albumCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return NextResponse.json(cached.data);
  }

  // Check if we have basic album info locally
  const localAlbum = albums.find((a: any) => a.id === albumId);
  if (!localAlbum) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 });
  }

  // If we have tracks stored locally, use them
  if (localAlbum.tracks && localAlbum.tracks.length > 0) {
    console.log(`✅ Using local tracks for album "${localAlbum.name}" (${localAlbum.tracks.length} tracks)`);
    const albumWithLocalTracks = {
      id: localAlbum.id,
      name: localAlbum.name,
      artist: localAlbum.artist,
      image: localAlbum.image,
      tracks: localAlbum.tracks
    };
    albumCache.set(cacheKey, { data: albumWithLocalTracks, timestamp: Date.now() });
    return NextResponse.json(albumWithLocalTracks);
  }

  // Only fetch from Spotify if we don't have local tracks
  try {
    console.log(`Fetching album details and tracks for ${albumId} from Spotify API`);

    // Ensure we have client access token
    if (!spotifyApiClient.getAccessToken()) {
      console.log('⚠️  No client access token, attempting to authenticate...');
      await authenticateSpotify();
    }

    // Check rate limits for both endpoints
    const albumLimit = checkEndpointRateLimit('getAlbum');
    const tracksLimit = checkEndpointRateLimit('getAlbumTracks');

    if (albumLimit !== true || tracksLimit !== true) {
      console.log(`Rate limited fetching album details for ${albumId}, using cached data`);
      if (cached) {
        return NextResponse.json(cached.data);
      }
      const album = albums.find((a: any) => a.id === albumId);
      return NextResponse.json(album || { error: 'Album not found' });
    }

    // Get album details and tracks in parallel
    const [albumData, tracksData] = await Promise.all([
      spotifyApiClient.getAlbum(albumId, { market: 'US' }),
      spotifyApiClient.getAlbumTracks(albumId, { market: 'US', limit: 50 })
    ]);

    // Record successful calls
    recordEndpointCall('getAlbum');
    recordEndpointCall('getAlbumTracks');

    const tracks = tracksData.body.items.map((track: any) => ({
      id: track.id,
      name: track.name,
      duration_ms: track.duration_ms,
      artist: track.artists[0]?.name || albumData.body.artists[0].name,
      track_number: track.track_number,
      disc_number: track.disc_number
    }));

    const album = {
      id: albumData.body.id,
      name: albumData.body.name,
      artist: albumData.body.artists[0].name,
      image: albumData.body.images[0]?.url || localAlbum.image,
      tracks: tracks
    };

    // Update the local albums array and save to file to avoid future API calls
    const albumIndex = albums.findIndex((a: any) => a.id === albumId);
    if (albumIndex !== -1) {
      albums[albumIndex] = { ...albums[albumIndex], tracks: tracks };
      try {
        fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albums, null, 2));
        console.log(`📁 Saved tracks for "${album.name}" to albums.json`);
      } catch (saveError) {
        console.error('❌ Failed to save updated tracks to albums.json:', saveError);
      }
    }

    albumCache.set(cacheKey, { data: album, timestamp: Date.now() });
    console.log(`Successfully cached album ${albumId} with ${album.tracks.length} tracks`);
    return NextResponse.json(album);
  } catch (error: any) {
    if (error.statusCode === 429) {
      const shouldRetry = await handleRateLimitError(error, `album details fetch for ${albumId}`);
      if (shouldRetry) {
        // Retry the operation
        try {
          const [albumData, tracksData] = await Promise.all([
            spotifyApiClient.getAlbum(albumId, { market: 'US' }),
            spotifyApiClient.getAlbumTracks(albumId, { market: 'US', limit: 50 })
          ]);

          const tracks = tracksData.body.items.map((track: any) => ({
            id: track.id,
            name: track.name,
            duration_ms: track.duration_ms,
            artist: track.artists[0]?.name || albumData.body.artists[0].name,
            track_number: track.track_number,
            disc_number: track.disc_number
          }));

          const album = {
            id: albumData.body.id,
            name: albumData.body.name,
            artist: albumData.body.artists[0].name,
            image: albumData.body.images[0]?.url || localAlbum.image,
            tracks: tracks
          };

          albumCache.set(cacheKey, { data: album, timestamp: Date.now() });
          console.log(`Successfully cached album ${albumId} with ${album.tracks.length} tracks (after retry)`);
          return NextResponse.json(album);
        } catch (retryError) {
          console.log('Rate limited, using cached or fallback data for album:', albumId);
          if (cached) {
            return NextResponse.json(cached.data);
          }
        }
      } else {
        console.log('Rate limited, using cached or fallback data for album:', albumId);
        if (cached) {
          return NextResponse.json(cached.data);
        }
      }
    }

    console.error('Error fetching album:', albumId, error);
    console.error('Error details:', {
      statusCode: error.statusCode,
      message: error.message,
      body: error.body
    });

    // Fallback to JSON
    const album = albums.find((a: any) => a.id === albumId);
    if (album) {
      return NextResponse.json(album);
    } else {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 });
    }
  }
}