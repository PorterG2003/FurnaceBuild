import React, { createContext, useContext, useState, ReactNode } from 'react';

export type BackgroundVariant = 'dots' | 'solid' | 'none';

interface BackgroundContextType {
  variant: BackgroundVariant;
  setVariant: (variant: BackgroundVariant) => void;
}

const BackgroundContext = createContext<BackgroundContextType | undefined>(undefined);

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [variant, setVariant] = useState<BackgroundVariant>('solid');

  return (
    <BackgroundContext.Provider value={{ variant, setVariant }}>
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground() {
  const context = useContext(BackgroundContext);
  if (context === undefined) {
    throw new Error('useBackground must be used within a BackgroundProvider');
  }
  return context;
}

