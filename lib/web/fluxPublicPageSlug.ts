/** Normalize a single Flux public-page slug route param. */
export function normalizeSlugParam(raw: string | string[] | undefined): string | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    if (raw.length !== 1) return undefined;
    const trimmed = raw[0]?.trim();
    return trimmed || undefined;
  }
  const trimmed = raw.trim();
  return trimmed || undefined;
}

/** Parse `/p/{slug}` from a pathname (with or without trailing slash). */
export function slugFromFluxPublicPathname(pathname: string): string | undefined {
  const match = pathname.match(/^\/p\/([^/]+)\/?$/);
  const slug = match?.[1]?.trim();
  return slug || undefined;
}

/**
 * Resolve the prospect page slug from route params, falling back to the browser pathname.
 * Supports both `/p/foo` and `/p/foo/` without relying on URL redirects.
 */
export function resolveFluxPublicPageSlug(
  slugRaw: string | string[] | undefined,
  pathname?: string,
): string | undefined {
  return normalizeSlugParam(slugRaw) ?? (pathname ? slugFromFluxPublicPathname(pathname) : undefined);
}
