import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_USERNAME, ADMIN_PASSWORD } from '@/lib/env';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    // If no admin password configured, allow login in dev for convenience
    const configured = ADMIN_PASSWORD && ADMIN_PASSWORD.length > 0;
    const valid = configured
      ? username === ADMIN_USERNAME && password === ADMIN_PASSWORD
      : true;

    if (!valid) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // After admin login, start Spotify OAuth
    return NextResponse.json({ ok: true, redirect: '/auth/login' });
  } catch (e) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

