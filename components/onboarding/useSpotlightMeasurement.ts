import { useEffect, useState, type RefObject } from 'react';
import { findNodeHandle, Platform, useWindowDimensions, type ScrollView, type View } from 'react-native';
import type { SpotlightStep } from '@/lib/onboarding/types';
import { isNavOnboardingTarget } from '@/lib/onboarding/useNavOnboardingTargets';
import { useOnboarding } from './context';
import type { TargetRect } from './context';

export type SpotlightScope = 'viewport' | 'container';

const MEASURE_RETRY_MS = 100;
const MEASURE_MAX_ATTEMPTS = 25; // ~2.5s before skipping a missing target

interface Size {
  width: number;
  height: number;
}

function readWebViewportSize(fallbackWidth: number, fallbackHeight: number): Size {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { width: fallbackWidth, height: fallbackHeight };
  }
  const visualViewport = window.visualViewport;
  return {
    width: visualViewport?.width ?? window.innerWidth ?? fallbackWidth,
    height: visualViewport?.height ?? window.innerHeight ?? fallbackHeight,
  };
}

type WebRectNode = { getBoundingClientRect?: () => DOMRect };
type NativeMeasureNode = {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
};

function measureNodeInWindow(node: unknown): Promise<TargetRect | null> {
  const native = node as NativeMeasureNode | null;
  if (!native?.measureInWindow) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      native.measureInWindow!((x, y, width, height) => {
        if (width === 0 && height === 0) resolve(null);
        else resolve({ x, y, width, height });
      });
    } catch {
      resolve(null);
    }
  });
}

/** Measures the target relative to its host container (both in the same space). */
async function measureInContainer(
  targetNode: unknown,
  containerNode: unknown,
): Promise<{ rect: TargetRect; size: Size } | null> {
  if (targetNode == null || containerNode == null) return null;

  if (Platform.OS === 'web') {
    const t = (targetNode as WebRectNode).getBoundingClientRect?.();
    const c = (containerNode as WebRectNode).getBoundingClientRect?.();
    if (!t || !c || t.width <= 0 || t.height <= 0 || c.width <= 0) return null;
    return {
      rect: { x: t.left - c.left, y: t.top - c.top, width: t.width, height: t.height },
      size: { width: c.width, height: c.height },
    };
  }

  const [t, c] = await Promise.all([
    measureNodeInWindow(targetNode),
    measureNodeInWindow(containerNode),
  ]);
  if (!t || !c) return null;
  return {
    rect: { x: t.x - c.x, y: t.y - c.y, width: t.width, height: t.height },
    size: { width: c.width, height: c.height },
  };
}

interface UseSpotlightMeasurementArgs {
  step: SpotlightStep;
  scope: SpotlightScope;
  /** Required for container scope: the host surface the cutout is relative to. */
  containerRef?: RefObject<View | null>;
  /** Optional: the scrollable region inside the host, for scroll-into-view. */
  scrollRef?: RefObject<ScrollView | null>;
}

export interface SpotlightMeasurement {
  /** Target rect in the scope's coordinate space (viewport or container), or null until measured. */
  rect: TargetRect | null;
  /** The size of the coordinate space (viewport for `viewport`, container for `container`). */
  space: Size;
  /** Container size for container scope (== space); undefined for viewport scope. */
  containerSize: Size | null;
}

/**
 * Measures the active spotlight target with retry, remeasure, and scroll-into-view,
 * for either the app viewport or a modal host container.
 *
 * - `viewport`: rect is viewport-normalized (via the provider's `measureTarget`);
 *   space is the web visual viewport (web) or window size (native).
 * - `container`: rect is relative to `containerRef` (via `getTargetNode` +
 *   container node); space is the container size. No viewport listeners or body
 *   scroll lock — those belong to the viewport surface only.
 */
export function useSpotlightMeasurement({
  step,
  scope,
  containerRef,
  scrollRef,
}: UseSpotlightMeasurementArgs): SpotlightMeasurement {
  const { measureTarget, getTargetNode, abortFlow, skipStep } = useOnboarding();
  const { width: vw, height: vh } = useWindowDimensions();
  const isContainer = scope === 'container';

  const [rect, setRect] = useState<TargetRect | null>(null);
  const [webViewport, setWebViewport] = useState(() => readWebViewportSize(vw, vh));
  const [containerSize, setContainerSize] = useState<Size | null>(null);

  // --- Viewport size tracking (viewport scope only) ------------------------
  useEffect(() => {
    if (isContainer || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const syncViewport = () => setWebViewport(readWebViewportSize(vw, vh));
    const passiveScrollOptions = { passive: true } as const;
    syncViewport();
    const visualViewport = window.visualViewport;
    window.addEventListener('resize', syncViewport);
    visualViewport?.addEventListener('resize', syncViewport);
    visualViewport?.addEventListener('scroll', syncViewport, passiveScrollOptions);
    return () => {
      window.removeEventListener('resize', syncViewport);
      visualViewport?.removeEventListener('resize', syncViewport);
      visualViewport?.removeEventListener('scroll', syncViewport);
    };
  }, [isContainer, vw, vh]);

  // --- Measure with retry --------------------------------------------------
  useEffect(() => {
    let active = true;
    let attempts = 0;
    let scrolled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scrollIntoViewOnce = () => {
      if (scrolled || step.scrollIntoView === false) return;
      const node = getTargetNode(step.targetId);
      if (Platform.OS === 'web') {
        const webNode = node as { scrollIntoView?: (opts?: ScrollIntoViewOptions) => void } | null;
        if (webNode?.scrollIntoView) {
          webNode.scrollIntoView(
            isContainer ? { block: 'nearest', inline: 'nearest' } : { block: 'center', inline: 'center' },
          );
          scrolled = true;
        }
        return;
      }
      // Native container scope: scroll the host's ScrollView so the target sits
      // in the upper portion, leaving room for the callout below it.
      if (isContainer && scrollRef?.current && node) {
        const scrollHandle = findNodeHandle(scrollRef.current);
        const measurable = node as {
          measureLayout?: (
            relativeTo: number,
            onSuccess: (x: number, y: number, w: number, h: number) => void,
            onFail?: () => void,
          ) => void;
        };
        if (scrollHandle != null && measurable.measureLayout) {
          try {
            measurable.measureLayout(
              scrollHandle,
              (_x, y) => {
                scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
              },
              () => {},
            );
            scrolled = true;
          } catch {
            /* best effort */
          }
        }
      }
    };

    const applyResult = (r: TargetRect | null, size?: Size | null) => {
      if (!active) return;
      if (r) {
        setRect(r);
        if (size) setContainerSize(size);
        return;
      }
      scrolled = false;
      attempts += 1;
      if (attempts >= MEASURE_MAX_ATTEMPTS) {
        if (step.skipIfTargetMissing) skipStep();
        else abortFlow();
        return;
      }
      timer = setTimeout(tryMeasure, MEASURE_RETRY_MS);
    };

    const tryMeasure = () => {
      if (!active) return;
      scrollIntoViewOnce();
      if (isContainer) {
        void measureInContainer(getTargetNode(step.targetId), containerRef?.current ?? null).then(
          (result) => applyResult(result?.rect ?? null, result?.size ?? null),
        );
      } else {
        void measureTarget(step.targetId).then((r) => applyResult(r));
      }
    };
    tryMeasure();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [
    step.targetId,
    step.hostId,
    step.route,
    step.skipIfTargetMissing,
    step.scrollIntoView,
    scope,
    isContainer,
    measureTarget,
    getTargetNode,
    abortFlow,
    skipStep,
    containerRef,
    scrollRef,
  ]);

  // --- Remeasure on web resize/scroll --------------------------------------
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const remeasure = () => {
      if (isContainer) {
        void measureInContainer(getTargetNode(step.targetId), containerRef?.current ?? null).then(
          (result) => {
            if (!result) return;
            setRect(result.rect);
            setContainerSize(result.size);
          },
        );
      } else {
        void measureTarget(step.targetId).then((r) => setRect(r));
      }
    };
    const passiveScrollOptions = { passive: true } as const;
    const visualViewport = window.visualViewport;
    window.addEventListener('resize', remeasure);
    visualViewport?.addEventListener('resize', remeasure);
    visualViewport?.addEventListener('scroll', remeasure, passiveScrollOptions);
    return () => {
      window.removeEventListener('resize', remeasure);
      visualViewport?.removeEventListener('resize', remeasure);
      visualViewport?.removeEventListener('scroll', remeasure);
    };
  }, [step.targetId, scope, isContainer, measureTarget, getTargetNode, containerRef]);

  // --- Nav items animate width on expand; remeasure after the transition ---
  useEffect(() => {
    if (isContainer || !isNavOnboardingTarget(step.targetId)) return;
    const delays = [50, 150, 320, 500];
    const timers = delays.map((ms) =>
      setTimeout(() => {
        void measureTarget(step.targetId).then((r) => r && setRect(r));
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [step.targetId, isContainer, measureTarget]);

  // --- Settle remeasures for container scope (layout/animation) ------------
  useEffect(() => {
    if (!isContainer) return;
    const delays = [60, 180, 360];
    const timers = delays.map((ms) =>
      setTimeout(() => {
        void measureInContainer(getTargetNode(step.targetId), containerRef?.current ?? null).then(
          (result) => {
            if (!result) return;
            setRect(result.rect);
            setContainerSize(result.size);
          },
        );
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [step.targetId, isContainer, getTargetNode, containerRef]);

  const space: Size = isContainer
    ? containerSize ?? { width: vw, height: vh }
    : Platform.OS === 'web'
      ? webViewport
      : { width: vw, height: vh };

  return { rect, space, containerSize: isContainer ? containerSize : null };
}
