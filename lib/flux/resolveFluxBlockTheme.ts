import type { ViewStyle } from 'react-native';
import type { FluxBlockAppearance, ThemeConfig } from './types';
import { enrichThemeConfig } from './enrichThemeConfig';
import {
  getFluxPresentationTokens,
  withFluxAlpha,
  type FluxPresentationTokens,
} from './fluxPresentationTokens';

const APPEARANCE_TO_THEME: Partial<Record<keyof FluxBlockAppearance, keyof ThemeConfig>> = {
  sectionBackgroundColor: 'backgroundColor',
  surfaceColor: 'surfaceColor',
  textColor: 'textColor',
  mutedTextColor: 'mutedTextColor',
  primaryColor: 'primaryColor',
  accentColor: 'accentColor',
  onPrimaryColor: 'onPrimaryColor',
  borderColor: 'borderColor',
  errorColor: 'errorColor',
};

/**
 * Shallow-merge block appearance overrides onto page theme (semantic fields only).
 */
export function mergeThemeWithBlockAppearance(
  theme: ThemeConfig,
  appearance?: FluxBlockAppearance,
): ThemeConfig {
  if (!appearance) return theme;
  const patch: Partial<ThemeConfig> = {};
  for (const [appKey, themeKey] of Object.entries(APPEARANCE_TO_THEME) as Array<
    [keyof FluxBlockAppearance, keyof ThemeConfig]
  >) {
    const v = appearance[appKey];
    if (typeof v === 'string' && v.length > 0) {
      (patch as Record<string, string>)[themeKey as string] = v;
    }
  }
  if (appearance.sectionBackgroundColor) {
    patch.backgroundColor = appearance.sectionBackgroundColor;
  }
  return enrichThemeConfig({ ...theme, ...patch });
}

export interface FluxBlockPresentation extends FluxPresentationTokens {
  /** Effective panel/side-card background (hero splitPanel). */
  panelSurfaceColor: string;
  panelCard: ViewStyle;
  headingColor: string;
  /** True when block `appearance.mutedTextColor` was set (hero subheadline, etc.). */
  hasMutedTextColorOverride: boolean;
}

export function getFluxBlockPresentation(
  theme: ThemeConfig,
  appearance?: FluxBlockAppearance,
): FluxBlockPresentation {
  const merged = mergeThemeWithBlockAppearance(theme, appearance);
  const base = getFluxPresentationTokens(merged);
  const panelSurfaceColor =
    appearance?.panelSurfaceColor ?? appearance?.surfaceColor ?? merged.surfaceColor;
  const panelCard: ViewStyle = {
    ...base.panelCard,
    backgroundColor: panelSurfaceColor,
  };
  const headingColor = appearance?.headingColor ?? merged.textColor;
  const hasMutedTextColorOverride = Boolean(appearance?.mutedTextColor);
  return {
    ...base,
    panelSurfaceColor,
    panelCard,
    headingColor,
    hasMutedTextColorOverride,
    mutedTextColor: appearance?.mutedTextColor ?? base.mutedTextColor,
    textColor: appearance?.textColor ?? base.textColor,
    sectionBackgroundColor: appearance?.sectionBackgroundColor ?? base.sectionBackgroundColor,
    onPrimaryColor: appearance?.onPrimaryColor ?? base.onPrimaryColor,
    primaryButton: {
      ...base.primaryButton,
      backgroundColor: appearance?.primaryColor ?? merged.primaryColor,
    },
    tintedCard: {
      ...base.tintedCard,
      backgroundColor:
        base.preset === 'minimal'
          ? panelSurfaceColor
          : withFluxAlpha(appearance?.primaryColor ?? merged.primaryColor, '14'),
    },
  };
}
