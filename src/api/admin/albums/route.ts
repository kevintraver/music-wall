import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, withRateLimit } from '@/lib/auth/middleware';
import { readAlbumsFromFile, writeAlbumsToFile } from '@/lib/utils/albums-file';
import { Album } from '@/websocket/types';
import { logger } from '@/lib/utils/logger';

// GET /api/admin/albums - List all albums
export const GET = withAdminAuth(async () => {
  try {
    const albums = readAlbumsFromFile();
    return NextResponse.json({
      success: true,
      data: albums,
      count: albums.length
    });
  } catch (error) {
    console.error('Error fetching albums:', error);
    return NextResponse.json(
      { error: 'Failed to fetch albums' },
      { status: 500 }
    );
  }
});

// POST /api/admin/albums - Create new album
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    try {
      let albumData: Omit<Album, 'position'>;
      try {
        albumData = await request.json();
      } catch (jsonError) {
        console.error('Failed to parse request JSON:', jsonError);
        return NextResponse.json(
          { error: 'Invalid JSON in request body' },
          { status: 400 }
        );
      }

      // Validate required fields
      if (!albumData.id || !albumData.name || !albumData.artist || !albumData.image) {
        return NextResponse.json(
          { error: 'Missing required fields: id, name, artist, image' },
          { status: 400 }
        );
      }

      // Check if album already exists
      let existingAlbums: Album[];
      try {
        existingAlbums = readAlbumsFromFile();
      } catch (readError) {
        console.error('Failed to read albums file:', readError);
        return NextResponse.json(
          { error: 'Failed to read albums data' },
          { status: 500 }
        );
      }

      if (existingAlbums.some((album: Album) => album.id === albumData.id)) {
        return NextResponse.json(
          { error: 'Album already exists' },
          { status: 409 }
        );
      }

      // Add album with position
      const newAlbum: Album = {
        ...albumData,
        position: existingAlbums.length
      };

      const updatedAlbums = [...existingAlbums, newAlbum];

      try {
        writeAlbumsToFile(updatedAlbums);
      } catch (writeError) {
        console.error('Failed to write albums file:', writeError);
        return NextResponse.json(
          { error: 'Failed to save album data' },
          { status: 500 }
        );
      }

      // Broadcast update via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({ type: 'albums', albums: updatedAlbums });
      }

      console.log(`✅ Added album "${newAlbum.name}" by ${newAlbum.artist}`);

      return NextResponse.json({
        success: true,
        data: newAlbum,
        message: 'Album added successfully'
      }, { status: 201 });

    } catch (error) {
      console.error('Error creating album:', error);
      return NextResponse.json(
        { error: 'Failed to create album' },
        { status: 500 }
      );
    }
  })
);

// PUT /api/admin/albums/[id] - Update album
export const PUT = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.split('/').pop();

      if (!id) {
        return NextResponse.json(
          { error: 'Album ID required' },
          { status: 400 }
        );
      }

      const updateData: Partial<Album> = await request.json();
      const existingAlbums = readAlbumsFromFile();

      const albumIndex = existingAlbums.findIndex((album: Album) => album.id === id);
      if (albumIndex === -1) {
        return NextResponse.json(
          { error: 'Album not found' },
          { status: 404 }
        );
      }

      // Update album
      const updatedAlbum = { ...existingAlbums[albumIndex], ...updateData };
      existingAlbums[albumIndex] = updatedAlbum;

      writeAlbumsToFile(existingAlbums);

      // Broadcast update via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({ type: 'albums', albums: existingAlbums });
      }

      console.log(`✅ Updated album "${updatedAlbum.name}"`);

      return NextResponse.json({
        success: true,
        data: updatedAlbum,
        message: 'Album updated successfully'
      });

    } catch (error) {
      console.error('Error updating album:', error);
      return NextResponse.json(
        { error: 'Failed to update album' },
        { status: 500 }
      );
    }
  })
);

// DELETE /api/admin/albums/[id] - Delete album
export const DELETE = withAdminAuth(async (request: NextRequest) => {
  try {
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return NextResponse.json(
        { error: 'Album ID required' },
        { status: 400 }
      );
    }

    const existingAlbums = readAlbumsFromFile();
    const albumToDelete = existingAlbums.find((album: Album) => album.id === id);

    if (!albumToDelete) {
      return NextResponse.json(
        { error: 'Album not found' },
        { status: 404 }
      );
    }

    const updatedAlbums = existingAlbums
      .filter((album: Album) => album.id !== id)
      .map((album: Album, index: number) => ({ ...album, position: index }));
    writeAlbumsToFile(updatedAlbums);

      // Broadcast update via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({ type: 'albums', albums: updatedAlbums });
      }

    console.log(`✅ Deleted album "${albumToDelete.name}"`);

    return NextResponse.json({
      success: true,
      message: 'Album deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting album:', error);
    return NextResponse.json(
      { error: 'Failed to delete album' },
      { status: 500 }
    );
  }
});
