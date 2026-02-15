/**
 * Preset color palette for thread tags. All tag UIs use only these colors.
 */

export const TAG_PRESET_COLORS: readonly string[] = [
  '#F3440D', // orange (brand)
  '#818CF8', // indigo
  '#34D399', // emerald
  '#FBBF24', // amber
  '#F472B6', // pink
  '#60A5FA', // blue
  '#A78BFA', // violet
  '#2DD4BF', // teal
  '#FB923C', // orange-400
  '#94A3B8', // slate
] as const;

const PRESET_SET = new Set(TAG_PRESET_COLORS);

/**
 * Pick a random color from the preset palette.
 */
export function pickRandomPresetColor(): string {
  const i = Math.floor(Math.random() * TAG_PRESET_COLORS.length);
  return TAG_PRESET_COLORS[i];
}

/**
 * Return true if the given value is one of the preset colors.
 */
export function isPresetColor(color: string | null | undefined): boolean {
  if (color == null || color === '') return false;
  return PRESET_SET.has(color);
}

/**
 * Resolve a tag's display color: use stored color if it's a preset, otherwise fallback.
 */
export function resolveTagColor(color: string | null | undefined, fallback = 'rgba(243, 68, 13, 0.2)'): string {
  if (color && isPresetColor(color)) return color;
  return fallback;
}

/**
 * Convert a hex color to a translucent background (for pill styling).
 */
export function hexToPillBackground(hex: string, alpha = 0.2): string {
  const match = hex.replace('#', '').match(/.{2}/g);
  if (!match) return `rgba(243, 68, 13, ${alpha})`;
  const r = parseInt(match[0], 16);
  const g = parseInt(match[1], 16);
  const b = parseInt(match[2], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
