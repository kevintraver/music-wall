import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_USERNAME, ADMIN_PASSWORD } from '@/lib/utils/env';

export async function POST(request: NextRequest) {
  try {
    console.log('Admin login attempt received');

    const body = await request.json();
    const { username, password } = body;

    console.log('Login attempt:', { username: username || 'undefined', hasPassword: !!password });

    // If no admin password configured, allow login in dev for convenience
    const configured = ADMIN_PASSWORD && ADMIN_PASSWORD.length > 0;
    console.log('Admin auth configured:', configured, 'Username:', ADMIN_USERNAME);

    const valid = configured
      ? username === ADMIN_USERNAME && password === ADMIN_PASSWORD
      : true;

    console.log('Login valid:', valid);

    if (!valid) {
      console.log('Invalid credentials provided');
      return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 401 });
    }

    // After admin login, start Spotify OAuth
    console.log('Login successful, redirecting to OAuth');
    return NextResponse.json({ ok: true, redirect: '/auth/login' });
  } catch (e) {
    console.error('Admin login error:', e);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
