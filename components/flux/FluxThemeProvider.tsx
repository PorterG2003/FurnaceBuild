import React, { createContext, useContext, useMemo } from 'react';
import type { ThemeConfig } from '@/lib/flux/types';
import {
  getFluxPresentationTokens,
  type FluxPresentationTokens,
} from '@/lib/flux/fluxPresentationTokens';

const DEFAULT_THEME: ThemeConfig = {
  primaryColor: '#4f46e5',
  accentColor: '#4f46e5',
  backgroundColor: '#f5f5f5',
  textColor: '#1a1a1a',
  fontFamily: 'Inter',
};

const FluxThemeContext = createContext<ThemeConfig>(DEFAULT_THEME);
const FluxPresentationContext = createContext<FluxPresentationTokens>(
  getFluxPresentationTokens(DEFAULT_THEME),
);

export function useFluxTheme(): ThemeConfig {
  return useContext(FluxThemeContext);
}

export function useFluxPresentation(): FluxPresentationTokens {
  return useContext(FluxPresentationContext);
}

export function FluxThemeProvider({
  theme,
  children,
}: {
  theme: ThemeConfig;
  children: React.ReactNode;
}) {
  const presentation = useMemo(() => getFluxPresentationTokens(theme), [theme]);

  return (
    <FluxThemeContext.Provider value={theme}>
      <FluxPresentationContext.Provider value={presentation}>
        {children}
      </FluxPresentationContext.Provider>
    </FluxThemeContext.Provider>
  );
}
