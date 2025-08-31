import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, withRateLimit } from '@/lib/auth/middleware';
import type { Album } from '@/websocket/types';

// POST /api/admin/albums/sync - Broadcast full albums list (no file storage)
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    try {
      const body = await request.json();

      // Accept either { albums: Album[] } or raw Album[]
      const albums: Album[] = Array.isArray(body) ? body : Array.isArray(body?.albums) ? body.albums : [];

      if (!Array.isArray(albums)) {
        return NextResponse.json(
          { error: 'Invalid request body - expected array of albums' },
          { status: 400 }
        );
      }

      // Basic validation on required fields
      for (const album of albums) {
        if (!album?.id || !album?.name || !album?.artist || !album?.image) {
          return NextResponse.json(
            { error: 'Invalid album data - missing required fields' },
            { status: 400 }
          );
        }
      }

      // Broadcast update via WebSocket (no persistence)
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({ type: 'albums', albums });
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Error syncing albums:', error);
      return NextResponse.json(
        { error: 'Failed to sync albums' },
        { status: 500 }
      );
    }
  })
);

