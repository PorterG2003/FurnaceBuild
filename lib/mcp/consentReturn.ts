const MCP_CONSENT_PATH = '/mcp/oauth/consent';

/**
 * Only allow relative return paths to the MCP OAuth consent page.
 * Rejects absolute URLs and open redirects.
 */
export function parseMcpConsentReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  // Absolute / protocol-relative URLs are never allowed (check path only — query may
  // contain redirect_uri=http://… for the MCP client callback).
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//')) return null;
  const pathOnly = decoded.split('?')[0]?.split('#')[0] ?? '';
  if (pathOnly !== MCP_CONSENT_PATH) return null;
  return decoded;
}

/** Build /auth?return_to=… for signing in and returning to consent with OAuth params. */
export function buildMcpConsentAuthHref(consentPathWithQuery: string): string {
  const safe = parseMcpConsentReturnTo(consentPathWithQuery);
  const returnTo = safe ?? MCP_CONSENT_PATH;
  return `/auth?return_to=${encodeURIComponent(returnTo)}`;
}

export function isMcpConsentPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return path === MCP_CONSENT_PATH;
}
