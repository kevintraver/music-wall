'use client';

import React from 'react';
import { AppStateProvider } from '@/lib/utils/state-context';
import { TokenProvider } from '@/lib/auth/token-context';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TokenProvider>
      <AppStateProvider>{children}</AppStateProvider>
    </TokenProvider>
  );
}

