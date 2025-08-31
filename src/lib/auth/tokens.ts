// Utility functions for token management using localStorage (client-side)

export function getTokens() {
  if (typeof window === 'undefined') {
    // Server-side fallback
    return {
      accessToken: '',
      refreshToken: ''
    };
  }

  return {
    accessToken: localStorage.getItem('spotify_access_token') || '',
    refreshToken: localStorage.getItem('spotify_refresh_token') || ''
  };
}

export function setTokens(accessToken: string, refreshToken: string = '') {
  if (typeof window === 'undefined') return;

  if (accessToken) {
    localStorage.setItem('spotify_access_token', accessToken);
  } else {
    localStorage.removeItem('spotify_access_token');
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
}

export function isAuthenticated() {
  const { accessToken } = getTokens();
  return !!accessToken;
}