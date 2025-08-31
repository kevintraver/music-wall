import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, withRateLimit } from '@/lib/auth/middleware';
import { readAlbumsFromFile, writeAlbumsToFile } from '@/lib/utils/albums-file';
import { Album } from '@/websocket/types';
import { logger } from '@/lib/utils/logger';

// GET /api/admin/albums/[id] - Get single album
export const GET = withAdminAuth(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  try {
    const albums = readAlbumsFromFile();
    const album = albums.find((a: Album) => a.id === params.id);

    if (!album) {
      return NextResponse.json(
        { error: 'Album not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: album
    });
  } catch (error) {
    console.error('Error fetching album:', error);
    return NextResponse.json(
      { error: 'Failed to fetch album' },
      { status: 500 }
    );
  }
});

// PUT /api/admin/albums/[id] - Update album
export const PUT = withRateLimit(
  withAdminAuth(async (
    request: NextRequest,
    { params }: { params: { id: string } }
  ) => {
    try {
      const updateData: Partial<Album> = await request.json();
      const existingAlbums = readAlbumsFromFile();

      const albumIndex = existingAlbums.findIndex((album: Album) => album.id === params.id);
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

      logger.success(`Updated album "${updatedAlbum.name}"`);

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
export const DELETE = withAdminAuth(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  try {
    const existingAlbums = readAlbumsFromFile();
    const albumToDelete = existingAlbums.find((album: Album) => album.id === params.id);

    if (!albumToDelete) {
      return NextResponse.json(
        { error: 'Album not found' },
        { status: 404 }
      );
    }

    const updatedAlbums = existingAlbums
      .filter((album: Album) => album.id !== params.id)
      .map((album: Album, index: number) => ({ ...album, position: index }));
    writeAlbumsToFile(updatedAlbums);

      // Broadcast update via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({ type: 'albums', albums: updatedAlbums });
      }

    logger.success(`Deleted album "${albumToDelete.name}"`);

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
