import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth/middleware';

// Legacy filesystem-backed admin endpoints removed.
// Admin now manages albums via localStorage and /api/admin/albums/sync.

export const POST = withAdminAuth(async () =>
  NextResponse.json({ error: 'Legacy endpoint removed. Use /api/admin/albums/sync.' }, { status: 410 })
);

