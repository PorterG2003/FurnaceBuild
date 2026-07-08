export type DocsSection = 'docs' | 'reference';

const DOCS_BASE = '/docs';

export function getDocsSection(pathname: string): DocsSection {
  const normalized = pathname.startsWith(DOCS_BASE)
    ? pathname
    : `${DOCS_BASE}${pathname.startsWith('/') ? '' : '/'}${pathname}`;

  if (normalized === `${DOCS_BASE}/reference` || normalized.startsWith(`${DOCS_BASE}/reference/`)) {
    return 'reference';
  }

  return 'docs';
}

/** Compare sidebar URLs (include /docs) with Next pathname (basePath-stripped). */
export function isNavActive(pathname: string, href: string): boolean {
  const normalizedPath = pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
  const normalizedHref = href.endsWith('/') && href.length > 1 ? href.slice(0, -1) : href;

  if (normalizedPath === normalizedHref) return true;

  const hrefWithoutBase = normalizedHref.startsWith(`${DOCS_BASE}/`)
    ? normalizedHref.slice(DOCS_BASE.length)
    : normalizedHref;

  return normalizedPath === hrefWithoutBase || normalizedPath === normalizedHref;
}

export function navHref(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
    return url;
  }
  if (url.startsWith(`${DOCS_BASE}/`) || url === DOCS_BASE) {
    return url;
  }
  return `${DOCS_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}
