import { Platform } from 'react-native';
import { buildAppRoutePath, type AppRouteHref } from './appRoutePath';

export type { AppRouteHref } from './appRoutePath';
export { buildAppRoutePath } from './appRoutePath';

type RouterLike = {
  push: (href: AppRouteHref) => void;
};

/**
 * Navigate in-app. On web, `newTab` opens the route in a new browser tab.
 */
export function openAppRoute(
  router: RouterLike,
  href: AppRouteHref,
  options?: { newTab?: boolean },
): void {
  const path = buildAppRoutePath(href);
  if (options?.newTab && Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(path, '_blank', 'noopener,noreferrer');
    return;
  }
  router.push(href);
}
