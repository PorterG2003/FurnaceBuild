import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Prompts the user before closing the browser tab while `active` is true (web only).
 */
export function usePreventTabClose(active: boolean): void {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
