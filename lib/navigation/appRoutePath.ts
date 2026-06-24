export type AppRouteHref =
  | string
  | {
      pathname: string;
      params?: Record<string, string | undefined>;
    };

/** Build an in-app path (with query string) for use with router or window.open. */
export function buildAppRoutePath(href: AppRouteHref): string {
  if (typeof href === 'string') {
    return href.startsWith('/') ? href : `/${href}`;
  }

  let pathname = href.pathname;
  const search = new URLSearchParams();
  const usedInPath = new Set<string>();

  if (href.params) {
    pathname = pathname.replace(/\[([^\]]+)\]/g, (match, key: string) => {
      const value = href.params![key];
      if (value != null && value !== '') {
        usedInPath.add(key);
        return encodeURIComponent(value);
      }
      return match;
    });

    for (const [key, value] of Object.entries(href.params)) {
      if (value != null && value !== '' && !usedInPath.has(key)) {
        search.set(key, value);
      }
    }
  }

  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
