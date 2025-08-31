export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

// Single source of truth for redirect URI
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || '';

export function assertSpotifyEnv() {
  if (!SPOTIFY_CLIENT_ID) throw new Error('Missing SPOTIFY_CLIENT_ID');
  if (!SPOTIFY_REDIRECT_URI) throw new Error('Missing SPOTIFY_REDIRECT_URI');
  // SPOTIFY_CLIENT_SECRET is optional for PKCE, required only for confidential flows
}

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Public app base URL for post-auth redirects (can differ from Spotify redirect host)
export const APP_BASE_URL = process.env.APP_BASE_URL || '';
