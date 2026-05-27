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

  const search = new URLSearchParams();
  if (href.params) {
    for (const [key, value] of Object.entries(href.params)) {
      if (value != null && value !== '') {
        search.set(key, value);
      }
    }
  }
  const qs = search.toString();
  return qs ? `${href.pathname}?${qs}` : href.pathname;
}
