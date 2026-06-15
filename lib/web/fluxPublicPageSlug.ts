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

/** True when pathname is `/p/{slug}/` (trailing slash breaks expo-router route matching on web). */
export function fluxPublicPageTrailingSlashPath(pathname: string): string | null {
  const match = pathname.match(/^\/p\/([^/]+)\/$/);
  const slug = match?.[1]?.trim();
  return slug ? `/p/${slug}` : null;
}

/**
 * Canonical path for a Flux public page URL, stripping a trailing slash when present.
 * Returns null when the path is not a trailing-slash `/p/{slug}/` URL.
 */
export function fluxPublicPageCanonicalPath(pathname: string, search = '', hash = ''): string | null {
  const base = fluxPublicPageTrailingSlashPath(pathname);
  if (!base) return null;
  return `${base}${search}${hash}`;
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
