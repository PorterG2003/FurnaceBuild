import { Linking, Platform } from 'react-native';
import { parseInPageScrollTargetFromCtaUrl } from './fluxScrollTag';

export type FluxInPageScrollApi = {
  scrollToDomId: (domId: string) => void;
};

/**
 * Open external URL or scroll to an in-page section when `ctaUrl` is `#fragment`.
 */
export function handleFluxCtaPress(ctaUrl: string, scroll: FluxInPageScrollApi | null | undefined): void {
  const t = ctaUrl.trim();
  const inPage = parseInPageScrollTargetFromCtaUrl(t);
  if (inPage) {
    if (scroll) {
      scroll.scrollToDomId(inPage);
      return;
    }
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.getElementById(inPage)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  if (!t) return;
  void Linking.openURL(t);
}
