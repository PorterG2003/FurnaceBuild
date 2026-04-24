/** Display names stored on brand profile / theme (Google Fonts). */
export const FLUX_GOOGLE_FONT_NAMES = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Raleway',
  'Playfair Display',
  'Source Sans Pro',
  'Nunito',
] as const;

export type FluxGoogleFontName = (typeof FLUX_GOOGLE_FONT_NAMES)[number];

/**
 * Google Fonts CSS2 URL. `fontFamily` in RN Web should match these display names once the stylesheet loads.
 */
export function fluxGoogleFontsCss2Href(families: readonly string[]): string {
  const unique = [...new Set(families.map((f) => f.trim()).filter(Boolean))];
  if (unique.length === 0) return '';
  const params = unique.map((displayName) => `family=${encodeURIComponent(displayName)}:wght@400;600;700`);
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}
