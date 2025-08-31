import { NextRequest, NextResponse } from 'next/server';
import { getTokens } from './tokens';

// API Authentication Middleware
export function withAuth<T extends any[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse> | NextResponse
) {
  return async (request: NextRequest, ...args: T) => {
    try {
      // Prefer tokens passed via headers (client supplies from localStorage)
      const headerAccessToken = request.headers.get('x-spotify-access-token') || '';
      const clientAccessToken = getTokens().accessToken || '';
      const effectiveAccessToken = headerAccessToken || clientAccessToken || '';

      if (!effectiveAccessToken) {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }

      // Add token to request headers for use in handlers
      const requestWithAuth = new NextRequest(request.url, {
        method: request.method,
        headers: new Headers({
          ...Object.fromEntries(request.headers.entries()),
          'x-spotify-access-token': effectiveAccessToken,
        }),
        body: request.body,
        duplex: 'half',
      } as any);

      return handler(requestWithAuth, ...(args as T));
    } catch (error) {
      console.error('Auth middleware error:', error);
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 500 }
      );
    }
  };
}

// Admin-only middleware
export function withAdminAuth<T extends any[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse> | NextResponse
) {
  return withAuth(async (request, ...args: T) => {
    // For now, any authenticated user is considered admin
    // In the future, you could add role-based checks here
    return handler(request, ...(args as T));
  });
}

// Optional auth middleware (doesn't fail if no token)
export function withOptionalAuth(handler: (request: NextRequest) => Promise<NextResponse> | NextResponse) {
  return async (request: NextRequest) => {
    try {
      const { accessToken: clientAccess } = getTokens();
      const headerAccess = request.headers.get('x-spotify-access-token') || '';
      const effective = headerAccess || clientAccess || '';

      const requestWithAuth = new NextRequest(request.url, {
        method: request.method,
        headers: new Headers({
          ...Object.fromEntries(request.headers.entries()),
          ...(effective && { 'x-spotify-access-token': effective }),
        }),
        body: request.body,
        duplex: 'half',
      } as any);

      return handler(requestWithAuth);
    } catch (error) {
      console.error('Optional auth middleware error:', error);
      return handler(request);
    }
  };
}

// WebSocket Authentication
export interface WSAuthResult {
  isAuthenticated: boolean;
  isAdmin: boolean;
  userId?: string;
  error?: string;
}

export async function authenticateWebSocket(accessToken?: string, refreshToken?: string): Promise<WSAuthResult> {
  if (!accessToken) {
    return {
      isAuthenticated: false,
      isAdmin: false,
      error: 'No access token provided'
    };
  }

  try {
    // Validate token by making a test request to Spotify
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      const userData = await response.json();
      return {
        isAuthenticated: true,
        isAdmin: true, // For now, any authenticated user is admin
        userId: userData.id,
      };
    } else if (response.status === 401 && refreshToken) {
      // Try to refresh token
      const refreshResult = await refreshAccessToken(refreshToken);
      if (refreshResult.success) {
        return authenticateWebSocket(refreshResult.accessToken, refreshResult.refreshToken);
      }
    }

    return {
      isAuthenticated: false,
      isAdmin: false,
      error: 'Invalid access token'
    };
  } catch (error) {
    console.error('WebSocket authentication error:', error);
    return {
      isAuthenticated: false,
      isAdmin: false,
      error: 'Authentication service unavailable'
    };
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
}> {
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
      return {
        success: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Token refresh error:', error);
    return { success: false };
  }
}

// Rate limiting helpers
export class RateLimiter {
  private requests: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(
    private maxRequests: number = 100,
    private windowMs: number = 15 * 60 * 1000 // 15 minutes
  ) {}

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const userRequests = this.requests.get(identifier);

    if (!userRequests || now > userRequests.resetTime) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return true;
    }

    if (userRequests.count >= this.maxRequests) {
      return false;
    }

    userRequests.count++;
    return true;
  }

  getRemainingRequests(identifier: string): number {
    const userRequests = this.requests.get(identifier);
    if (!userRequests) return this.maxRequests;

    const now = Date.now();
    if (now > userRequests.resetTime) {
      return this.maxRequests;
    }

    return Math.max(0, this.maxRequests - userRequests.count);
  }

  getResetTime(identifier: string): number {
    const userRequests = this.requests.get(identifier);
    return userRequests?.resetTime || Date.now();
  }
}

// Global rate limiter instance
export const apiRateLimiter = new RateLimiter();

// Rate limiting middleware
export function withRateLimit<T extends any[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse> | NextResponse,
  limiter: RateLimiter = apiRateLimiter
) {
  return async (request: NextRequest, ...args: T) => {
    // Use IP address as identifier (in production, you'd want more sophisticated identification)
    const identifier = request.headers.get('x-forwarded-for') ||
                      request.headers.get('x-real-ip') ||
                      'unknown';

    if (!limiter.isAllowed(identifier)) {
      const resetTime = limiter.getResetTime(identifier);
      const remaining = limiter.getRemainingRequests(identifier);

      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': resetTime.toString(),
            'Retry-After': Math.ceil((resetTime - Date.now()) / 1000).toString()
          }
        }
      );
    }

    return handler(request, ...args);
  };
}
