import { NextResponse } from 'next/server';
import { withAdminAuth, withRateLimit } from '@/lib/auth/middleware';

// Legacy filesystem-backed admin endpoints removed.
// Admin now manages albums via localStorage and /api/admin/albums/sync.

export const GET = withAdminAuth(async () =>
  NextResponse.json({ error: 'Legacy endpoint removed. Use /api/admin/albums/sync.' }, { status: 410 })
);

export const PUT = withRateLimit(
  withAdminAuth(async () =>
    NextResponse.json({ error: 'Legacy endpoint removed. Use /api/admin/albums/sync.' }, { status: 410 })
  )
);

export const DELETE = withAdminAuth(async () =>
  NextResponse.json({ error: 'Legacy endpoint removed. Use /api/admin/albums/sync.' }, { status: 410 })
);

