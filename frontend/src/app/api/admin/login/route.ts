import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  // Basic auth check, then redirect to Spotify OAuth
  if (username === 'admin' && password === 'password') {
    return NextResponse.json({ redirect: '/auth/login' });
  } else {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
}