import { Platform } from 'react-native';

type InterLoadedWeight = '400' | '500' | '600' | '700';

const INTER_NATIVE: Record<InterLoadedWeight, string> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
};

export type FluxPreviewFontWeight = InterLoadedWeight;

/**
 * Resolves theme `fontFamily` for Flux page preview blocks.
 * Web: CSS name as stored (Google Fonts stylesheet must be loaded).
 * Native: Inter maps to @expo-google-fonts/inter postscript names; other families fall through (system fallback until loaded).
 */
export function fluxPreviewFontFamily(
  themeFont: string | undefined,
  weight: FluxPreviewFontWeight = '400',
): string {
  const name = (themeFont || 'Inter').trim();
  if (Platform.OS === 'web') return name;
  if (name === 'Inter') return INTER_NATIVE[weight];
  return name;
}
