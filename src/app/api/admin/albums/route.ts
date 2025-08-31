import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
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
  } catch (error) {
    console.error('Spotify client authentication failed:', error);
  }
}

// Initialize authentication
authenticateSpotify();

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

export async function POST(request: NextRequest) {
  const newAlbum = await request.json();

  if (!albums.find((a: any) => a.id === newAlbum.id)) {
    try {
      console.log(`Adding new album: ${newAlbum.name} (${newAlbum.id})`);

      // Ensure we have client access token
      if (!spotifyApiClient.getAccessToken()) {
        console.log('⚠️  No client access token for admin add, attempting to authenticate...');
        await authenticateSpotify();
      }

      // Fetch complete album data including tracks from Spotify
      const [albumData, tracksData] = await Promise.all([
        spotifyApiClient.getAlbum(newAlbum.id, { market: 'US' }),
        spotifyApiClient.getAlbumTracks(newAlbum.id, { market: 'US', limit: 50 })
      ]);

      // Validate responses
      if (!albumData.body || !tracksData.body || !tracksData.body.items) {
        throw new Error('Invalid response from Spotify API');
      }

      // Create complete album object with tracks
      const completeAlbum = {
        id: albumData.body.id,
        name: albumData.body.name,
        artist: albumData.body.artists[0].name,
        image: albumData.body.images[0]?.url || newAlbum.image,
        position: newAlbum.position || albums.length,
        tracks: tracksData.body.items.map((track: any) => ({
          id: track.id,
          name: track.name,
          duration_ms: track.duration_ms,
          artist: track.artists[0]?.name || albumData.body.artists[0].name,
          track_number: track.track_number,
          disc_number: track.disc_number
        }))
      };

      albums.push(completeAlbum);
      console.log(`✅ Added album "${completeAlbum.name}" with ${completeAlbum.tracks.length} tracks`);

      // Save to file
      fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albums, null, 2));

      return NextResponse.json({
        success: true,
        album: completeAlbum,
        tracksCount: completeAlbum.tracks.length
      });

    } catch (error: any) {
      console.error('Error fetching album data for admin add:', error);

      if (error.statusCode === 429) {
        const shouldRetry = await handleRateLimitError(error, `admin add album ${newAlbum.name}`);
        if (shouldRetry) {
          // Retry the operation
          try {
            const [albumData, tracksData] = await Promise.all([
              spotifyApiClient.getAlbum(newAlbum.id, { market: 'US' }),
              spotifyApiClient.getAlbumTracks(newAlbum.id, { market: 'US', limit: 50 })
            ]);

            if (!albumData.body || !tracksData.body || !tracksData.body.items) {
              throw new Error('Invalid response from Spotify API');
            }

            const completeAlbum = {
              id: albumData.body.id,
              name: albumData.body.name,
              artist: albumData.body.artists[0].name,
              image: albumData.body.images[0]?.url || newAlbum.image,
              position: newAlbum.position || albums.length,
              tracks: tracksData.body.items.map((track: any) => ({
                id: track.id,
                name: track.name,
                duration_ms: track.duration_ms,
                artist: track.artists[0]?.name || albumData.body.artists[0].name,
                track_number: track.track_number,
                disc_number: track.disc_number
              }))
            };

            albums.push(completeAlbum);
            console.log(`✅ Added album "${completeAlbum.name}" with ${completeAlbum.tracks.length} tracks (after retry)`);

            fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albums, null, 2));

            return NextResponse.json({
              success: true,
              album: completeAlbum,
              tracksCount: completeAlbum.tracks.length
            });
          } catch (retryError) {
            console.error('Retry failed for admin add:', retryError);
          }
        }
      }

      // Fallback: add basic album data if Spotify fetch fails
      console.log('⚠️  Falling back to basic album data');
      const basicAlbum = {
        ...newAlbum,
        tracks: [] // Empty tracks array as fallback
      };
      albums.push(basicAlbum);
      fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albums, null, 2));

      return NextResponse.json({
        success: true,
        album: basicAlbum,
        tracksCount: 0,
        warning: 'Album added with basic data only (Spotify fetch failed)'
      });
    }
  } else {
    return NextResponse.json({ error: 'Album already exists' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Album ID required' }, { status: 400 });
  }

  albums = albums.filter((a: any) => a.id !== id);
  fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albums, null, 2));
  return NextResponse.json({ success: true });
}
