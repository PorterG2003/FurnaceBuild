import type { Block } from './types';

const MAX_SCROLL_TAG_LEN = 120;

/**
 * Normalize a user-authored scroll tag into a safe HTML `id` / hash fragment (lowercase slug).
 * Returns null when empty or unusable after normalization.
 */
export function normalizeFluxScrollTagToDomId(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.length > MAX_SCROLL_TAG_LEN) s = s.slice(0, MAX_SCROLL_TAG_LEN);
  if (s.startsWith('#')) s = s.slice(1).trim();
  if (!s) return null;
  const slug = s
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return null;
  if (/^[0-9]/.test(slug)) return `s-${slug}`;
  return slug;
}

/**
 * When `ctaUrl` is a pure in-page hash (e.g. `#pricing`), returns the normalized DOM id to scroll to.
 * Full URLs with fragments are not treated as in-page scroll targets.
 */
export function parseInPageScrollTargetFromCtaUrl(url: string): string | null {
  const t = url.trim();
  if (!t.startsWith('#')) return null;
  const frag = t.slice(1);
  if (!frag.trim()) return null;
  if (frag.includes('/') || frag.includes(':') || frag.includes('\\')) return null;
  return normalizeFluxScrollTagToDomId(frag);
}

/**
 * Assign a unique DOM id per block from optional `scrollTag`, preserving document order for collisions.
 */
export function computeResolvedAnchorDomIdByBlockId(blocks: Block[]): Map<string, string | null> {
  const sorted = [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const out = new Map<string, string | null>();
  const used = new Set<string>();
  for (const b of sorted) {
    const base = normalizeFluxScrollTagToDomId(b.scrollTag);
    if (!base) {
      out.set(b.id, null);
      continue;
    }
    let domId = base;
    if (used.has(domId)) {
      const suffix = b.id.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'block';
      domId = `${base}-${suffix}`;
    }
    let guard = 0;
    while (used.has(domId) && guard < 50) {
      domId = `${domId}-x`;
      guard += 1;
    }
    used.add(domId);
    out.set(b.id, domId);
  }
  return out;
}
