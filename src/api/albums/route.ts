import { NextRequest, NextResponse } from 'next/server';

// Deprecated: albums are managed entirely on the client via localStorage.
// This route remains for backward compatibility but returns an empty list.
export async function GET(_request: NextRequest) {
  return NextResponse.json([]);
}
