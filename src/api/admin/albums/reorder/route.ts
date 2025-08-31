import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth/middleware';
import { writeAlbumsToFile } from '@/lib/utils/albums-file';
import { Album } from '@/websocket/types';

// POST /api/admin/albums/reorder - Reorder albums
export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const reorderedAlbums: Album[] = await request.json();

    if (!Array.isArray(reorderedAlbums)) {
      return NextResponse.json(
        { error: 'Invalid request body - expected array of albums' },
        { status: 400 }
      );
    }

    // Validate that all albums have required fields
    for (const album of reorderedAlbums) {
      if (!album.id || !album.name || !album.artist || !album.image) {
        return NextResponse.json(
          { error: 'Invalid album data - missing required fields' },
          { status: 400 }
        );
      }
    }

    // Update positions and save
    const albumsWithPositions = reorderedAlbums.map((album, index) => ({
      ...album,
      position: index
    }));

    writeAlbumsToFile(albumsWithPositions);

    // Broadcast update via WebSocket
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({ type: 'albums', payload: albumsWithPositions });
    }

    console.log(`✅ Albums reordered successfully (${albumsWithPositions.length} albums)`);

    return NextResponse.json({
      success: true,
      message: 'Albums reordered successfully',
      data: albumsWithPositions
    });

  } catch (error) {
    console.error('Error reordering albums:', error);
    return NextResponse.json(
      { error: 'Failed to reorder albums' },
      { status: 500 }
    );
  }
});
