import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'Album ID required' }, { status: 400 });
  }

  let albums = loadAlbums();
  const albumExists = albums.some((a: any) => a.id === id);

  if (!albumExists) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 });
  }

   albums = albums.filter((a: any) => a.id !== id);
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