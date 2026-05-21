/**
 * Lightweight website/domain normalization for search keys.
 * Kept dependency-free so Metro (Flux app) can import without Node ESM .js resolution.
 */

export function preprocessWebsiteInputString(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, '');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (s.length >= 2) {
    const q = s[0];
    const e = s[s.length - 1];
    if ((q === '"' && e === '"') || (q === '\u201C' && e === '\u201D') || (q === "'" && e === "'")) {
      s = s.slice(1, -1).trim();
    }
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1).trim();
  }
  return s.trim();
}

export function canonicalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = preprocessWebsiteInputString(raw);
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (!/^https?:$/i.test(u.protocol)) return null;
    const host = u.hostname.replace(/\.$/, '').toLowerCase();
    if (!host) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function normalizeGoogleAdsSearchDomain(raw: string | null | undefined): string | null {
  const canonical = canonicalizeWebsiteUrl(raw);
  if (!canonical) return null;
  try {
    const url = new URL(canonical);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '')
      .trim();
    return hostname || null;
  } catch {
    return null;
  }
}
