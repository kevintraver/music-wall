import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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

export async function POST(request: NextRequest) {
  const reorderedAlbums = await request.json();

  if (!Array.isArray(reorderedAlbums)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Update the albums array with new positions
  albums = reorderedAlbums.map((album: any, index: number) => ({
    ...album,
    position: index
  }));

  // Save to JSON file
  fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albums, null, 2));

  // Send WebSocket update to all clients
  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      type: 'albums',
      albums: albums
    });
  }

  return NextResponse.json({ success: true });
}