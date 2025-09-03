'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getTokens, ensureValidToken, isAuthenticated, clearTokens } from './tokens';

interface TokenContextType {
  isAuthenticated: boolean;
  isRefreshing: boolean;
  refreshToken: () => Promise<boolean>;
  ensureValidToken: () => Promise<boolean>;
  logout: () => void;
}

const TokenContext = createContext<TokenContextType | undefined>(undefined);

interface TokenProviderProps {
  children: ReactNode;
}

export function TokenProvider({ children }: TokenProviderProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [authStatus, setAuthStatus] = useState(isAuthenticated());

  // Check authentication status periodically
  useEffect(() => {
    const checkAuth = async () => {
      const currentAuth = isAuthenticated();
      if (currentAuth !== authStatus) {
        setAuthStatus(currentAuth);
      }
    };

    // Check immediately
    checkAuth();

    // Check every 30 seconds
    const interval = setInterval(checkAuth, 30000);

    return () => clearInterval(interval);
  }, [authStatus]);

  // Auto-refresh token when needed
  useEffect(() => {
    if (!authStatus) return;

    const autoRefresh = async () => {
      const isValid = await ensureValidToken();
      if (!isValid) {
        console.log('Failed to refresh token, logging out');
        logout();
      }
    };

    // Check token validity every 5 minutes
    const interval = setInterval(autoRefresh, 5 * 60 * 1000);

    // Also check on mount
    autoRefresh();

    return () => clearInterval(interval);
  }, [authStatus]);

  const refreshToken = async (): Promise<boolean> => {
    setIsRefreshing(true);
    try {
      const success = await ensureValidToken();
      if (success) {
        setAuthStatus(true);
      }
      return success;
    } finally {
      setIsRefreshing(false);
    }
  };

  const logout = () => {
    clearTokens();
    setAuthStatus(false);
  };

  const value: TokenContextType = {
    isAuthenticated: authStatus,
    isRefreshing,
    refreshToken,
    ensureValidToken: () => ensureValidToken(),
    logout,
  };

  return (
    <TokenContext.Provider value={value}>
      {children}
    </TokenContext.Provider>
  );
}

export function useToken() {
  const context = useContext(TokenContext);
  if (context === undefined) {
    throw new Error('useToken must be used within a TokenProvider');
  }
  return context;
}

// Hook to ensure token is valid before making API calls
export function useAuthenticatedFetch() {
  const { ensureValidToken, isAuthenticated } = useToken();

  return async (url: string, options: RequestInit = {}): Promise<Response> => {
    if (!isAuthenticated) {
      throw new Error('Not authenticated');
    }

    // Ensure token is valid before making the request
    await ensureValidToken();

    const { accessToken } = getTokens();

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
      },
    });
  };
}