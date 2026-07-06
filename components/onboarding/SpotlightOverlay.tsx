import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ScrollView,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOTTOM_NAV_SCROLL_PADDING } from '@/components/ui/layout';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import type { SpotlightStep } from '@/lib/onboarding/types';
import { isNavOnboardingTarget } from '@/lib/onboarding/useNavOnboardingTargets';
import { useOnboarding } from './context';
import { SpotlightCallout } from './SpotlightCallout';
import {
  CALLOUT_WIDTH,
  EDGE_PAD,
  ESTIMATED_CALLOUT_HEIGHT,
  clampSpotlightHoleToSpace,
  resolveCalloutPosition,
  resolveSpotlightHole,
} from './spotlightCalloutPosition';
import { useSpotlightMeasurement, type SpotlightScope } from './useSpotlightMeasurement';

const OVERLAY_Z = 99998;
const CONTAINER_DIM = 'rgba(0,0,0,0.55)';

interface SpotlightOverlayProps {
  step: SpotlightStep;
  isLastStep: boolean;
  canGoBack: boolean;
  /** When set (non-mandatory flow), StepControls shows a Skip link. */
  onSkip?: () => void;
  /** `viewport` (default) renders app-root; `container` renders inside a modal host. */
  scope?: SpotlightScope;
  /** Required for container scope: the host surface the cutout is relative to. */
  containerRef?: RefObject<View | null>;
  /** Optional for container scope: the scrollable region for scroll-into-view. */
  scrollRef?: RefObject<ScrollView | null>;
}

export function SpotlightOverlay({
  step,
  isLastStep,
  canGoBack,
  onSkip,
  scope = 'viewport',
  containerRef,
  scrollRef,
}: SpotlightOverlayProps) {
  const {
    getTargetNode,
    notifyTargetPress,
    next,
    back,
    progress,
    currentStepNextBlocked,
    reducedMotion,
  } = useOnboarding();

  const insets = useSafeAreaInsets();
  const isContainer = scope === 'container';
  const { rect, space } = useSpotlightMeasurement({ step, scope, containerRef, scrollRef });

  const viewportWidth = space.width;
  const viewportHeight = space.height;
  const useCutout = isContainer || Platform.OS === 'web';
  const isNarrowViewport = !isContainer && viewportWidth < LAYOUT_BREAKPOINT;
  const isNavTarget = !isContainer && isNavOnboardingTarget(step.targetId);
  const useNarrowCallout = isContainer || isNarrowViewport;

  const [calloutHeight, setCalloutHeight] = useState(ESTIMATED_CALLOUT_HEIGHT);
  useEffect(() => {
    setCalloutHeight(ESTIMATED_CALLOUT_HEIGHT);
  }, [step.targetId, step.hostId, step.placement]);

  const advance = step.advance ?? 'manual';
  const requiresInteraction = advance === 'onTargetPress' || advance === 'onRequirementMet';
  const showNext = advance === 'manual' || (advance === 'onTargetPress' && !useCutout);
  const nextDisabled =
    advance === 'manual' && !!step.nextGate?.waitForSignal && currentStepNextBlocked;
  const holeInteractive = requiresInteraction || nextDisabled;

  const geometry = useMemo(() => {
    if (!rect) return null;

    const hole = clampSpotlightHoleToSpace(
      resolveSpotlightHole(rect, { isNavTarget, isNarrow: isNarrowViewport }),
      space,
    );
    if (hole.width <= 0 || hole.height <= 0) return null;

    const topLimit = isContainer
      ? EDGE_PAD
      : isNarrowViewport
        ? insets.top + EDGE_PAD
        : EDGE_PAD;
    const bottomLimit = isContainer
      ? viewportHeight - EDGE_PAD
      : isNarrowViewport
        ? viewportHeight - BOTTOM_NAV_SCROLL_PADDING - insets.bottom
        : viewportHeight - EDGE_PAD;

    const calloutWidth = useNarrowCallout ? viewportWidth - EDGE_PAD * 2 : CALLOUT_WIDTH;
    const calloutPos = resolveCalloutPosition({
      rect,
      placement: step.placement,
      space,
      calloutWidth,
      calloutHeight,
      topLimit,
      bottomLimit,
      isNarrow: useNarrowCallout,
      isNavTarget,
    });

    return { hole, calloutPos };
  }, [
    rect,
    space,
    step.placement,
    calloutHeight,
    isContainer,
    isNarrowViewport,
    isNavTarget,
    useNarrowCallout,
    viewportWidth,
    viewportHeight,
    insets.top,
    insets.bottom,
  ]);

  const handleCalloutLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && Math.abs(h - calloutHeight) > 1) setCalloutHeight(h);
  };

  // Lock background scroll on web while a viewport spotlight is active. Container
  // scope must not touch the document (the host owns its own scroll region).
  useEffect(() => {
    if (isContainer || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isContainer]);

  // onTargetPress: detect a click on the real (highlighted) element (web).
  useEffect(() => {
    if (Platform.OS !== 'web' || advance !== 'onTargetPress') return;
    if (typeof document === 'undefined') return;
    const handler = (e: MouseEvent) => {
      const node = getTargetNode(step.targetId) as { contains?: (n: unknown) => boolean } | null;
      if (node?.contains && node.contains(e.target)) {
        notifyTargetPress(step.targetId);
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [advance, step.targetId, getTargetNode, notifyTargetPress]);

  const callout = (width?: number) => (
    <SpotlightCallout
      step={step}
      progress={progress}
      canGoBack={canGoBack}
      showNext={showNext}
      isLastStep={isLastStep}
      nextDisabled={nextDisabled}
      reducedMotion={reducedMotion}
      onBack={back}
      onNext={next}
      onSkip={onSkip}
      width={width}
      onLayout={handleCalloutLayout}
    />
  );

  const holeTransition = reducedMotion
    ? undefined
    : 'top 180ms ease, left 180ms ease, width 180ms ease, height 180ms ease';

  // --- Modal host (container scope): in-sheet cutout on all platforms -------
  if (isContainer) {
    if (!geometry) return null;

    const { hole, calloutPos } = geometry;

    const webDimStyle =
      Platform.OS === 'web'
        ? ({
            position: 'absolute',
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            borderRadius: hole.borderRadius,
            boxShadow: `0 0 0 9999px ${CONTAINER_DIM}`,
            ...(holeTransition ? { transition: holeTransition } : null),
          } as unknown as ViewStyle)
        : null;

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {Platform.OS === 'web' ? (
          <View style={webDimStyle!} pointerEvents="none" />
        ) : (
          <>
            <View
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: hole.top, backgroundColor: CONTAINER_DIM }}
              pointerEvents="none"
            />
            <View
              style={{ position: 'absolute', top: hole.top + hole.height, left: 0, right: 0, bottom: 0, backgroundColor: CONTAINER_DIM }}
              pointerEvents="none"
            />
            <View
              style={{ position: 'absolute', top: hole.top, left: 0, width: hole.left, height: hole.height, backgroundColor: CONTAINER_DIM }}
              pointerEvents="none"
            />
            <View
              style={{ position: 'absolute', top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height, backgroundColor: CONTAINER_DIM }}
              pointerEvents="none"
            />
          </>
        )}

        {holeInteractive ? (
          <>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: hole.top }} />
            <View style={{ position: 'absolute', top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
            <View style={{ position: 'absolute', top: hole.top, left: 0, width: hole.left, height: hole.height }} />
            <View style={{ position: 'absolute', top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          </>
        ) : (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} accessibilityElementsHidden />
        )}

        <View
          style={{
            position: 'absolute',
            top: calloutPos.top,
            left: calloutPos.left,
            width: calloutPos.width,
          }}
        >
          {callout(useNarrowCallout ? undefined : CALLOUT_WIDTH)}
        </View>
      </View>
    );
  }

  // --- Mobile / native viewport fallback: bottom callout card, no cutout ----
  if (!useCutout) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: holeInteractive ? 'transparent' : 'rgba(0,0,0,0.55)',
          }}
          pointerEvents={holeInteractive ? 'box-none' : 'auto'}
        >
          <View style={{ padding: 16, pointerEvents: 'auto' }}>{callout()}</View>
        </View>
      </Modal>
    );
  }

  // --- Web viewport: dim + cutout via box-shadow -----------------------------
  if (!geometry) return null;

  const { hole, calloutPos } = geometry;
  const { createPortal } = require('react-dom');

  const content = (
    <div style={{ position: 'fixed', inset: 0, zIndex: OVERLAY_Z, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'fixed',
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          borderRadius: hole.borderRadius,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          transition: holeTransition ?? 'none',
        }}
      />

      {holeInteractive ? (
        <>
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: Math.max(0, hole.top), pointerEvents: 'auto' }} />
          <div style={{ position: 'fixed', top: hole.top + hole.height, left: 0, right: 0, bottom: 0, pointerEvents: 'auto' }} />
          <div style={{ position: 'fixed', top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height, pointerEvents: 'auto' }} />
          <div style={{ position: 'fixed', top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height, pointerEvents: 'auto' }} />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'auto' }} />
      )}

      <div
        style={{
          position: 'fixed',
          top: calloutPos.top,
          left: calloutPos.left,
          width: calloutPos.width,
          pointerEvents: 'auto',
        }}
      >
        {callout(useNarrowCallout ? undefined : CALLOUT_WIDTH)}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
