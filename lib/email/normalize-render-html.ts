type RgbColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export const MAILBOX_RENDER_BACKGROUND = '#1A1A1A';
export const MAILBOX_RENDER_TEXT_COLOR = '#D1D5DB';
export const MAILBOX_RENDER_LINK_COLOR = '#F3440D';

const MIN_CONTRAST_RATIO = 4.5;

const NAMED_COLORS: Record<string, string> = {
  aqua: '#00ffff',
  black: '#000000',
  blue: '#0000ff',
  brown: '#a52a2a',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  gold: '#ffd700',
  gray: '#808080',
  green: '#008000',
  grey: '#808080',
  indigo: '#4b0082',
  lime: '#00ff00',
  magenta: '#ff00ff',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  orange: '#ffa500',
  pink: '#ffc0cb',
  purple: '#800080',
  red: '#ff0000',
  silver: '#c0c0c0',
  teal: '#008080',
  transparent: 'rgba(0,0,0,0)',
  white: '#ffffff',
  yellow: '#ffff00',
};

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function parseHexColor(value: string): RgbColor | null {
  const hex = value.slice(1).trim();
  if (!/^[\da-f]{3,4}$|^[\da-f]{6}$|^[\da-f]{8}$/i.test(hex)) return null;

  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a = 'f'] = hex.split('');
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
      a: parseInt(a + a, 16) / 255,
    };
  }

  const body = hex.length === 6 ? hex + 'ff' : hex;
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
    a: parseInt(body.slice(6, 8), 16) / 255,
  };
}

function parseRgbChannel(token: string): number | null {
  const value = token.trim();
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value.slice(0, -1));
    if (!Number.isFinite(percent)) return null;
    return clampChannel((percent / 100) * 255);
  }
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? clampChannel(numeric) : null;
}

function parseAlphaChannel(token: string): number | null {
  const value = token.trim();
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value.slice(0, -1));
    if (!Number.isFinite(percent)) return null;
    return Math.max(0, Math.min(1, percent / 100));
  }
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null;
}

function parseRgbColor(value: string): RgbColor | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;

  const r = parseRgbChannel(parts[0]);
  const g = parseRgbChannel(parts[1]);
  const b = parseRgbChannel(parts[2]);
  const a = parts.length === 4 ? parseAlphaChannel(parts[3]) : 1;
  if (r == null || g == null || b == null || a == null) return null;

  return { r, g, b, a };
}

function hueToRgb(p: number, q: number, t: number): number {
  let adjusted = t;
  if (adjusted < 0) adjusted += 1;
  if (adjusted > 1) adjusted -= 1;
  if (adjusted < 1 / 6) return p + (q - p) * 6 * adjusted;
  if (adjusted < 1 / 2) return q;
  if (adjusted < 2 / 3) return p + (q - p) * (2 / 3 - adjusted) * 6;
  return p;
}

function parseHslColor(value: string): RgbColor | null {
  const match = value.match(/^hsla?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;

  const hue = Number.parseFloat(parts[0]);
  const saturation = Number.parseFloat(parts[1].replace('%', ''));
  const lightness = Number.parseFloat(parts[2].replace('%', ''));
  const alpha = parts.length === 4 ? parseAlphaChannel(parts[3]) : 1;
  if (![hue, saturation, lightness].every(Number.isFinite) || alpha == null) return null;

  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, saturation / 100));
  const l = Math.max(0, Math.min(1, lightness / 100));

  if (s === 0) {
    const gray = clampChannel(l * 255);
    return { r: gray, g: gray, b: gray, a: alpha };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clampChannel(hueToRgb(p, q, h + 1 / 3) * 255),
    g: clampChannel(hueToRgb(p, q, h) * 255),
    b: clampChannel(hueToRgb(p, q, h - 1 / 3) * 255),
    a: alpha,
  };
}

function parseColor(value: string): RgbColor | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['inherit', 'initial', 'unset', 'revert', 'currentcolor'].includes(normalized)) {
    return null;
  }

  if (normalized.startsWith('#')) return parseHexColor(normalized);
  if (normalized.startsWith('rgb')) return parseRgbColor(normalized);
  if (normalized.startsWith('hsl')) return parseHslColor(normalized);

  const named = NAMED_COLORS[normalized];
  return named ? parseColor(named) : null;
}

function compositeOverBackground(foreground: RgbColor, background: RgbColor): RgbColor {
  if (foreground.a >= 1) return foreground;
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };

  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: RgbColor): number {
  return 0.2126 * channelToLinear(color.r)
    + 0.7152 * channelToLinear(color.g)
    + 0.0722 * channelToLinear(color.b);
}

function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function cleanCssValue(value: string): string {
  return value.replace(/\s*!important\s*$/i, '').trim();
}

function shouldForceReadableColor(value: string): boolean {
  const parsed = parseColor(cleanCssValue(value));
  const background = parseColor(MAILBOX_RENDER_BACKGROUND);
  if (!parsed || !background) return false;
  const composited = compositeOverBackground(parsed, background);
  return contrastRatio(composited, background) < MIN_CONTRAST_RATIO;
}

function normalizeStyleAttribute(styleText: string): string {
  const declarations = styleText
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const normalized: string[] = [];
  for (const declaration of declarations) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) {
      normalized.push(declaration);
      continue;
    }

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    if (!value) continue;

    if (property === 'background' || property === 'background-color') {
      continue;
    }

    if (property === 'color' && shouldForceReadableColor(value)) {
      normalized.push(`color: ${MAILBOX_RENDER_TEXT_COLOR} !important`);
      continue;
    }

    normalized.push(`${declaration.slice(0, colonIndex).trim()}: ${value}`);
  }

  return normalized.join('; ');
}

function normalizeStyleTags(html: string): string {
  return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attrs, css) => {
    const withoutBackgrounds = css.replace(
      /(^|[;{]\s*)(background(?:-color)?)(\s*:\s*[^;}{]+)(?=;|}|$)/gi,
      '$1'
    );

    const normalizedColors = withoutBackgrounds.replace(
      /(^|[;{]\s*)(color)(\s*:\s*[^;}{]+)(?=;|}|$)/gi,
      (full: string, prefix: string, property: string, rawValue: string) => {
        const value = rawValue.replace(/^\s*:\s*/, '').trim();
        if (!shouldForceReadableColor(value)) return full;
        return `${prefix}${property}: ${MAILBOX_RENDER_TEXT_COLOR}`;
      }
    );

    const cleanedCss = normalizedColors
      .replace(/;\s*;/g, ';')
      .replace(/\{\s*;/g, '{ ')
      .replace(/;\s*}/g, '; }');

    return `<style${attrs}>${cleanedCss}</style>`;
  });
}

function normalizeLegacyColorAttributes(html: string): string {
  return html
    .replace(
      /\s(color|text|fgcolor)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (match, attr, _quoted, doubleQuoted, singleQuoted, bareValue) => {
        const value = doubleQuoted ?? singleQuoted ?? bareValue ?? '';
        if (!shouldForceReadableColor(value)) return match;
        return ` ${attr}="${MAILBOX_RENDER_TEXT_COLOR}"`;
      }
    )
    .replace(/\s(link|vlink|alink)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, attr) => {
      return ` ${attr}="${MAILBOX_RENDER_LINK_COLOR}"`;
    });
}

export function normalizeEmailHtmlForDarkMode(html: string | null | undefined): string {
  if (!html) return '';

  const withoutBackgroundAttrs = html.replace(
    /\s(bgcolor|background)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    ''
  );

  const withNormalizedStyleAttrs = withoutBackgroundAttrs.replace(
    /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_match, quotedValue, doubleQuoted, singleQuoted) => {
      const rawStyle = doubleQuoted ?? singleQuoted ?? quotedValue.slice(1, -1);
      const normalizedStyle = normalizeStyleAttribute(rawStyle);
      if (!normalizedStyle) return '';
      const quote = quotedValue[0] === "'" ? "'" : '"';
      return ` style=${quote}${normalizedStyle}${quote}`;
    }
  );

  return normalizeLegacyColorAttributes(normalizeStyleTags(withNormalizedStyleAttrs));
}
