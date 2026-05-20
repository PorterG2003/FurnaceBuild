import React, { createContext, useContext, useMemo } from 'react';
import type { FluxBlockAppearance, ThemeConfig } from '@/lib/flux/types';
import { enrichThemeConfig } from '@/lib/flux/enrichThemeConfig';
import {
  getFluxBlockPresentation,
  mergeThemeWithBlockAppearance,
  type FluxBlockPresentation,
} from '@/lib/flux/resolveFluxBlockTheme';
import {
  getFluxPresentationTokens,
  type FluxPresentationTokens,
} from '@/lib/flux/fluxPresentationTokens';

const DEFAULT_THEME: ThemeConfig = enrichThemeConfig({
  primaryColor: '#4f46e5',
  accentColor: '#4f46e5',
  backgroundColor: '#f5f5f5',
  textColor: '#1a1a1a',
  fontFamily: 'Inter',
});

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

/** Block-scoped presentation (includes panelCard, headingColor). */
export function useFluxBlockPresentation(): FluxBlockPresentation {
  return useContext(FluxPresentationContext) as FluxBlockPresentation;
}

export function FluxThemeProvider({
  theme,
  children,
}: {
  theme: ThemeConfig;
  children: React.ReactNode;
}) {
  const enriched = useMemo(() => enrichThemeConfig(theme), [theme]);
  const presentation = useMemo(() => getFluxPresentationTokens(enriched), [enriched]);

  return (
    <FluxThemeContext.Provider value={enriched}>
      <FluxPresentationContext.Provider value={presentation}>
        {children}
      </FluxPresentationContext.Provider>
    </FluxThemeContext.Provider>
  );
}

export function FluxBlockThemeProvider({
  theme,
  appearance,
  children,
}: {
  theme: ThemeConfig;
  appearance?: FluxBlockAppearance;
  children: React.ReactNode;
}) {
  const enriched = useMemo(() => enrichThemeConfig(theme), [theme]);
  const mergedTheme = useMemo(
    () => mergeThemeWithBlockAppearance(enriched, appearance),
    [enriched, appearance],
  );
  const presentation = useMemo(
    () => getFluxBlockPresentation(enriched, appearance),
    [enriched, appearance],
  );

  return (
    <FluxThemeContext.Provider value={mergedTheme}>
      <FluxPresentationContext.Provider value={presentation}>
        {children}
      </FluxPresentationContext.Provider>
    </FluxThemeContext.Provider>
  );
}
