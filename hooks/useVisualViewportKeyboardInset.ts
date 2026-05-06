import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Approximate height (px) of the layout viewport obscured by the software keyboard
 * on mobile browsers (Visual Viewport API). Always 0 on native.
 */
export function useVisualViewportKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const vv = window.visualViewport;
    if (!vv) return;

    const compute = () => {
      const layoutH = window.innerHeight;
      const visibleBottom = vv.offsetTop + vv.height;
      setInset(Math.max(0, Math.round(layoutH - visibleBottom)));
    };

    vv.addEventListener('resize', compute);
    vv.addEventListener('scroll', compute);
    compute();

    return () => {
      vv.removeEventListener('resize', compute);
      vv.removeEventListener('scroll', compute);
    };
  }, []);

  return inset;
}
