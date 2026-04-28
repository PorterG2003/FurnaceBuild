/**
 * Canonical 6-digit #RRGGBB strings for Flux theme/brand colors so alpha suffix
 * helpers in fluxPresentationTokens behave consistently.
 */

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f]{3})$/i;
const HEX6_NO_HASH = /^([0-9a-f]{6})$/i;

function channelsToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** True if `value` is exactly `#` + six hex digits (case-insensitive). */
export function isFluxHex6(value: string): boolean {
  return HEX6.test(value.trim());
}

/**
 * Parses `#RGB`, `#RRGGBB`, `RRGGBB`, or `#RRGGBBAA` into `#RRGGBB`, or null if invalid.
 */
export function normalizeFluxHexColor(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  let s = t;
  if (!s.startsWith('#')) {
    if (HEX6_NO_HASH.test(s)) s = `#${s}`;
    else return null;
  }

  const m8 = /^#([0-9a-f]{8})$/i.exec(s);
  if (m8) return `#${m8[1].slice(0, 6).toLowerCase()}`;

  const m6 = /^#([0-9a-f]{6})$/i.exec(s);
  if (m6) return `#${m6[1].toLowerCase()}`;

  const m3 = HEX3.exec(s);
  if (m3 && m3[1].length === 3) {
    const [a, b, c] = m3[1].toLowerCase().split('');
    return `#${a}${a}${b}${b}${c}${c}`;
  }

  return null;
}

export function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = normalizeFluxHexColor(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function formatRgbToHex(r: number, g: number, b: number): string {
  return channelsToHex(r, g, b);
}
