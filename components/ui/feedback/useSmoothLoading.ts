import { useEffect, useRef, useState } from 'react';
import { SKELETON_DELAY_MS, SKELETON_MIN_DISPLAY_MS } from './skeletonConstants';

type TimerHandle = ReturnType<typeof setTimeout>;

export interface UseSmoothLoadingOptions {
  delayMs?: number;
  minVisibleMs?: number;
}

/**
 * Smooth loader visibility so fast requests avoid flashing UI.
 *
 * Semantics intentionally match the existing page-level skeleton behavior:
 * - loading starts: wait `delayMs` before showing
 * - loading ends: if visible, wait `minVisibleMs` before hiding
 */
export function useSmoothLoading(
  isLoading: boolean,
  {
    delayMs = SKELETON_DELAY_MS,
    minVisibleMs = SKELETON_MIN_DISPLAY_MS,
  }: UseSmoothLoadingOptions = {},
): boolean {
  const [showLoader, setShowLoader] = useState(false);
  const showTimerRef = useRef<TimerHandle | null>(null);
  const hideTimerRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    if (isLoading) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (!showLoader && !showTimerRef.current) {
        showTimerRef.current = setTimeout(() => {
          showTimerRef.current = null;
          setShowLoader(true);
        }, delayMs);
      }

      return;
    }

    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }

    if (showLoader && !hideTimerRef.current) {
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        setShowLoader(false);
      }, minVisibleMs);
    }
  }, [delayMs, isLoading, minVisibleMs, showLoader]);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return showLoader;
}
