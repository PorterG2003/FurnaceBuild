import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_NAV_COLLAPSE_MODE,
  getCachedNavCollapseMode,
  loadNavCollapseMode,
  saveNavCollapseMode,
  type NavCollapseMode,
} from '@/lib/navigation/navCollapseMode';

/** Order the in-nav toggle cycles through on each press. */
const CYCLE_ORDER: readonly NavCollapseMode[] = ['auto', 'expanded', 'collapsed'];

export function nextNavCollapseMode(mode: NavCollapseMode): NavCollapseMode {
  const index = CYCLE_ORDER.indexOf(mode);
  return CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length];
}

export interface UseNavCollapseMode {
  mode: NavCollapseMode;
  loaded: boolean;
  setMode: (mode: NavCollapseMode) => void;
  cycleMode: () => void;
}

/**
 * Reads and persists the desktop sidebar collapse preference (per device).
 * Seeds from the in-memory cache so remounts apply the saved mode synchronously.
 */
export function useNavCollapseMode(): UseNavCollapseMode {
  const cached = getCachedNavCollapseMode();
  const [mode, setModeState] = useState<NavCollapseMode>(cached ?? DEFAULT_NAV_COLLAPSE_MODE);
  const [loaded, setLoaded] = useState(cached != null);

  useEffect(() => {
    if (loaded) return;
    let active = true;
    void loadNavCollapseMode().then((resolved) => {
      if (!active) return;
      setModeState(resolved);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [loaded]);

  const setMode = useCallback((next: NavCollapseMode) => {
    setModeState(next);
    void saveNavCollapseMode(next);
  }, []);

  const cycleMode = useCallback(() => {
    setModeState((current) => {
      const next = nextNavCollapseMode(current);
      void saveNavCollapseMode(next);
      return next;
    });
  }, []);

  return { mode, loaded, setMode, cycleMode };
}
