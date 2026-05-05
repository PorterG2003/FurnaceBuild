import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type RefObject,
} from 'react';
import { findNodeHandle, Platform, ScrollView, View, type NativeMethods } from 'react-native';

export type FluxPageScrollContextValue = {
  scrollToDomId: (domId: string) => void;
  setAnchorRef: (domId: string, node: View | null) => void;
};

const FluxPageScrollContext = createContext<FluxPageScrollContextValue | null>(null);

export function useFluxPageScroll(): FluxPageScrollContextValue | null {
  return useContext(FluxPageScrollContext);
}

type FluxPageScrollProviderProps = {
  children: React.ReactNode;
  /** When null (e.g. non-scrollable preview), only web `document` scroll is used. */
  scrollViewRef: RefObject<ScrollView | null> | null;
};

export function FluxPageScrollProvider({ children, scrollViewRef }: FluxPageScrollProviderProps) {
  const anchorNodesRef = useRef(new Map<string, View>());

  const setAnchorRef = useCallback((domId: string, node: View | null) => {
    if (!domId) return;
    if (node) anchorNodesRef.current.set(domId, node);
    else anchorNodesRef.current.delete(domId);
  }, []);

  const scrollToDomId = useCallback(
    (rawId: string) => {
      const id = rawId.startsWith('#') ? rawId.slice(1) : rawId;
      if (!id) return;

      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const scrollEl = scrollViewRef?.current;
      const target = anchorNodesRef.current.get(id);
      if (!scrollEl || !target) return;

      const scrollHandle = findNodeHandle(scrollEl);
      if (scrollHandle == null) return;

      const host = target as unknown as NativeMethods;
      host.measureLayout(
        scrollHandle,
        (_x: number, y: number) => {
          scrollEl.scrollTo({ y: Math.max(0, y - 12), animated: true });
        },
        () => {
          /* measure failed — ignore */
        },
      );
    },
    [scrollViewRef],
  );

  const value = useMemo(
    () => ({
      scrollToDomId,
      setAnchorRef,
    }),
    [scrollToDomId, setAnchorRef],
  );

  return <FluxPageScrollContext.Provider value={value}>{children}</FluxPageScrollContext.Provider>;
}
