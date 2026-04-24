import React from 'react';
import { useFluxAccess } from '@/hooks/useFluxAccess';
import { FluxAccessLoading } from './FluxAccessLoading';
import { FluxNotFound } from './FluxNotFound';

export function FluxGate({ children }: { children: React.ReactNode }) {
  const status = useFluxAccess();

  if (status === 'loading') {
    return <FluxAccessLoading />;
  }
  if (status === 'denied') {
    return <FluxNotFound />;
  }

  return <>{children}</>;
}
