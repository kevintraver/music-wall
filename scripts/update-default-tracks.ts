#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';

const DATA_DIR = path.join(process.cwd(), 'data');
const EXAMPLE_FILE = path.join(DATA_DIR, 'albums.example.json');

type Track = { id: string; name: string; duration_ms: number; artist?: string; image?: string };
type Album = { id: string; name: string; artist: string; image: string; position: number; tracks?: Track[] };

async function fetchFromLocalApi(albumId: string): Promise<{ tracks: Track[]; image?: string } | null> {
  const base = process.env.API_BASE || 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/api/album/${albumId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const tracks: Track[] = Array.isArray(data?.tracks) ? data.tracks : [];
    return { tracks, image: data?.image };
  } catch {
    return null;
  }
}

async function fetchFromSpotify(albumId: string): Promise<{ tracks: Track[]; image?: string } | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const spotify = new SpotifyWebApi({ clientId, clientSecret });
  try {
    const cc = await spotify.clientCredentialsGrant();
    spotify.setAccessToken(cc.body['access_token']);
    const album = await spotify.getAlbum(albumId, { market: 'US' });
    const image = album.body.images?.[0]?.url;

    const tracks: Track[] = [];
    let offset = 0;
    const limit = 50;
    while (true) {
      const tr = await spotify.getAlbumTracks(albumId, { offset, limit, market: 'US' });
      const items = tr.body.items || [];
      items.forEach(it => {
        tracks.push({
          id: it.id as string,
          name: it.name as string,
          duration_ms: (it as any).duration_ms ?? 0,
          artist: it.artists?.[0]?.name,
          image,
        });
      });
      if (!tr.body.next || items.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 150));
    }
    return { tracks, image };
  } catch {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(EXAMPLE_FILE)) {
    console.error('Example file not found:', EXAMPLE_FILE);
    process.exit(1);
  }

  const raw = fs.readFileSync(EXAMPLE_FILE, 'utf8');
  const albums: Album[] = JSON.parse(raw);

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    const needs = !Array.isArray(album.tracks) || album.tracks.length === 0;
    if (!needs) continue;

    console.log(`Fetching tracks for ${album.name} (${album.id})...`);

    let result = await fetchFromLocalApi(album.id);
    if (!result || result.tracks.length === 0) {
      result = await fetchFromSpotify(album.id);
    }
    if (!result || result.tracks.length === 0) {
      console.warn(`Skipping ${album.name}: could not fetch tracks`);
      continue;
    }

    albums[i] = {
      ...album,
      image: result.image || album.image,
      tracks: result.tracks,
    };

    // Write incremental updates to avoid losing progress
    fs.writeFileSync(EXAMPLE_FILE, JSON.stringify(albums, null, 2));
    // Small delay between albums
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('Done updating example albums with tracks.');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});

