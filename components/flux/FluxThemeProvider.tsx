import React, { createContext, useContext } from 'react';
import type { ThemeConfig } from '@/lib/flux/types';

const DEFAULT_THEME: ThemeConfig = {
  primaryColor: '#4f46e5',
  accentColor: '#4f46e5',
  backgroundColor: '#f5f5f5',
  textColor: '#1a1a1a',
  fontFamily: 'Inter',
};

const FluxThemeContext = createContext<ThemeConfig>(DEFAULT_THEME);

export function useFluxTheme(): ThemeConfig {
  return useContext(FluxThemeContext);
}

export function FluxThemeProvider({
  theme,
  children,
}: {
  theme: ThemeConfig;
  children: React.ReactNode;
}) {
  return (
    <FluxThemeContext.Provider value={theme}>
      {children}
    </FluxThemeContext.Provider>
  );
}
