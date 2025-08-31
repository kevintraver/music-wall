import { NextResponse } from 'next/server';

export async function POST() {
  // No server session to clear; client clears localStorage tokens.
  return NextResponse.json({ ok: true });
}

