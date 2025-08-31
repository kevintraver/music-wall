import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(process.cwd(), 'data', 'spotify-tokens.json');

// Token persistence - read fresh from file on each request
function getTokenStatus() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      const accessToken = tokens.accessToken || '';
      const refreshToken = tokens.refreshToken || '';
      return {
        authenticated: !!accessToken,
        hasRefreshToken: !!refreshToken,
        tokensLoaded: true
      };
    }
  } catch (error) {
    console.error('Error loading saved tokens:', error);
  }
  return {
    authenticated: false,
    hasRefreshToken: false,
    tokensLoaded: false
  };
}

export async function GET(request: NextRequest) {
  const status = getTokenStatus();
  return NextResponse.json(status);
}