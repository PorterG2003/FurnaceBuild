import { useCallback, useState } from 'react';
import type { View } from 'react-native';
import type { RefObject } from 'react';

export interface FilterAnchorLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function useInboxFilterUI() {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterAnchorLayout, setFilterAnchorLayout] = useState<FilterAnchorLayout | null>(null);

  const openFilterMenu = useCallback((ref: RefObject<View | null> | null) => {
    ref?.current?.measureInWindow((x, y, w, h) => {
      setFilterAnchorLayout({ x, y, w, h });
      setFilterMenuOpen(true);
    });
  }, []);

  return {
    filterMenuOpen,
    setFilterMenuOpen,
    filterAnchorLayout,
    setFilterAnchorLayout,
    openFilterMenu,
  };
}
