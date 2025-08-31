import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, withRateLimit } from '@/lib/auth/middleware';
import { getAlbums, saveAlbumsToStorage, addAlbum as addAlbumToStorage, removeAlbum as removeAlbumFromStorage } from '@/lib/utils/localStorage';
import { Album } from '@/websocket/types';

// GET /api/admin/albums - List all albums
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const albums = await getAlbums();
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
      const albumData: Omit<Album, 'position'> = await request.json();

      // Validate required fields
      if (!albumData.id || !albumData.name || !albumData.artist || !albumData.image) {
        return NextResponse.json(
          { error: 'Missing required fields: id, name, artist, image' },
          { status: 400 }
        );
      }

      // Check if album already exists
      const existingAlbums = await getAlbums();
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

      const updatedAlbums = addAlbumToStorage(newAlbum);

      // Broadcast update via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({
          type: 'albums',
          payload: updatedAlbums
        });
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
      const existingAlbums = await getAlbums();

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

      saveAlbumsToStorage(existingAlbums);

      // Broadcast update via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({
          type: 'albums',
          payload: existingAlbums
        });
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

    const existingAlbums = await getAlbums();
    const albumToDelete = existingAlbums.find((album: Album) => album.id === id);

    if (!albumToDelete) {
      return NextResponse.json(
        { error: 'Album not found' },
        { status: 404 }
      );
    }

    const updatedAlbums = removeAlbumFromStorage(id);

    // Broadcast update via WebSocket
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        type: 'albums',
        payload: updatedAlbums
      });
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
