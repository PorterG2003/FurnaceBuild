import React from 'react';
import { useFoundryAccess } from '@/hooks/useFoundryAccess';
import { FoundryAccessLoading } from './FoundryAccessLoading';
import { FoundryNotFound } from './FoundryNotFound';

export function FoundryGate({ children }: { children: React.ReactNode }) {
  const status = useFoundryAccess();

  if (status === 'loading') {
    return <FoundryAccessLoading />;
  }
  if (status === 'denied') {
    return <FoundryNotFound />;
  }

  return <>{children}</>;
}
