/** Normalize expo-router `slug` search param (string or string[]). */
export function normalizeSlugParam(raw: string | string[] | undefined): string | undefined {
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
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
 * Amplify adds a trailing slash (`/p/foo/`) which can leave `useLocalSearchParams().slug` empty.
 */
export function resolveFluxPublicPageSlug(
  slugRaw: string | string[] | undefined,
  pathname?: string,
): string | undefined {
  return normalizeSlugParam(slugRaw) ?? (pathname ? slugFromFluxPublicPathname(pathname) : undefined);
}
