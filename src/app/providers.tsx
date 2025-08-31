'use client';

import React from 'react';
import { AppStateProvider } from '@/lib/utils/state-context';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <AppStateProvider>{children}</AppStateProvider>;
}

