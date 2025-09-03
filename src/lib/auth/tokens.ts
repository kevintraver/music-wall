// Utility functions for token management using localStorage (client-side)

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number; // Timestamp when token expires
}

export function getTokens(): TokenData {
  if (typeof window === 'undefined') {
    // Server-side fallback
    return {
      accessToken: '',
      refreshToken: ''
    };
  }

  return {
    accessToken: localStorage.getItem('spotify_access_token') || '',
    refreshToken: localStorage.getItem('spotify_refresh_token') || '',
    expiresAt: parseInt(localStorage.getItem('spotify_token_expires_at') || '0') || undefined
  };
}

export function setTokens(accessToken: string, refreshToken: string = '', expiresIn?: number) {
  if (typeof window === 'undefined') return;

  if (accessToken) {
    localStorage.setItem('spotify_access_token', accessToken);
    // Set expiration time (default to 1 hour if not provided)
    const expiresAt = expiresIn ? Date.now() + (expiresIn * 1000) : Date.now() + (3600 * 1000);
    localStorage.setItem('spotify_token_expires_at', expiresAt.toString());
  } else {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_token_expires_at');
  }

  if (refreshToken) {
    localStorage.setItem('spotify_refresh_token', refreshToken);
  } else {
    localStorage.removeItem('spotify_refresh_token');
  }
}

export function clearTokens() {
  if (typeof window === 'undefined') return;

  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expires_at');
}

export function isAuthenticated() {
  const { accessToken } = getTokens();
  return !!accessToken;
}

export function isTokenExpired(): boolean {
  const { expiresAt } = getTokens();
  if (!expiresAt) return false;
  // Consider token expired if it expires within 5 minutes
  return Date.now() >= (expiresAt - (5 * 60 * 1000));
}

export async function refreshAccessToken(): Promise<boolean> {
  const { refreshToken } = getTokens();
  if (!refreshToken) return false;

  try {
    const { SPOTIFY_CLIENT_ID } = await import('@/lib/utils/env');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      // Update tokens with new access token and expiration
      setTokens(data.access_token, data.refresh_token || refreshToken, data.expires_in);

      // Also update server-side tokens if available
      try {
        const { setServerTokens } = await import('@/lib/auth/server-tokens');
        setServerTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token || refreshToken
        });

        // Update WebSocket tokens if available
        if (global.setSpotifyTokens) {
          global.setSpotifyTokens({
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken
          });
        }
      } catch (e) {
        console.error('Failed to update server tokens:', e);
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error('Token refresh error:', error);
    return false;
  }
}

// Auto-refresh token if it's expired or about to expire
export async function ensureValidToken(): Promise<boolean> {
  if (!isAuthenticated()) return false;

  if (isTokenExpired()) {
    console.log('Token expired or expiring soon, refreshing...');
    return await refreshAccessToken();
  }

  return true;
}