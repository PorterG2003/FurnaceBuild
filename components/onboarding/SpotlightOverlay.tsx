import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import type { SpotlightStep } from '@/lib/onboarding/types';
import { isNavOnboardingTarget } from '@/lib/onboarding/useNavOnboardingTargets';
import { useOnboarding } from './context';
import type { TargetRect } from './context';
import { StepControls } from './StepControls';

const CUTOUT_PADDING = 8;
const CALLOUT_WIDTH = 380;
const CALLOUT_GAP = 14;
const EDGE_PAD = 12;
const ESTIMATED_CALLOUT_HEIGHT = 210;
const OVERLAY_Z = 99998;

const MEASURE_RETRY_MS = 100;
const MEASURE_MAX_ATTEMPTS = 25; // ~2.5s before skipping a missing target

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

function positionCallout(
  rect: TargetRect,
  placement: SpotlightStep['placement'],
  vw: number,
  vh: number,
): { top: number; left: number } {
  const p = placement ?? 'bottom';
  let top: number;
  let left: number;
  switch (p) {
    case 'top':
      top = rect.y - CALLOUT_GAP - ESTIMATED_CALLOUT_HEIGHT;
      left = rect.x + rect.width / 2 - CALLOUT_WIDTH / 2;
      break;
    case 'left':
      top = rect.y;
      left = rect.x - CALLOUT_GAP - CALLOUT_WIDTH;
      break;
    case 'right':
      top = rect.y;
      left = rect.x + rect.width + CALLOUT_GAP;
      break;
    case 'bottom':
    default:
      top = rect.y + rect.height + CALLOUT_GAP;
      left = rect.x + rect.width / 2 - CALLOUT_WIDTH / 2;
      break;
  }
  return {
    top: clamp(top, EDGE_PAD, Math.max(EDGE_PAD, vh - ESTIMATED_CALLOUT_HEIGHT - EDGE_PAD)),
    left: clamp(left, EDGE_PAD, Math.max(EDGE_PAD, vw - CALLOUT_WIDTH - EDGE_PAD)),
  };
}

interface SpotlightOverlayProps {
  step: SpotlightStep;
  isLastStep: boolean;
  canGoBack: boolean;
  /** When set (non-mandatory flow), StepControls shows a Skip link. */
  onSkip?: () => void;
}

export function SpotlightOverlay({ step, isLastStep, canGoBack, onSkip }: SpotlightOverlayProps) {
  const {
    measureTarget,
    getTargetNode,
    notifyTargetPress,
    abortFlow,
    next,
    back,
    progress,
    advanceGateBlocked,
    reducedMotion,
  } = useOnboarding();
  const { width: vw, height: vh } = useWindowDimensions();
  // Real cutout on all web (including the PWA on phones); native keeps the
  // dimmed bottom-card fallback. On narrow web the callout docks to the bottom.
  const useCutout = Platform.OS === 'web';
  const isNarrow = vw < LAYOUT_BREAKPOINT;
  const narrowCallout = useCutout && isNarrow;

  const [rect, setRect] = useState<TargetRect | null>(null);
  const advance = step.advance ?? 'manual';
  const requiresInteraction = advance === 'onTargetPress' || advance === 'onRequirementMet';
  const showNext =
    advance === 'manual' || (advance === 'onTargetPress' && !useCutout);
  const nextDisabled = advance === 'manual' && advanceGateBlocked;
  const holeInteractive =
    requiresInteraction || (advance === 'manual' && advanceGateBlocked);

  // Measure target with retry. If it never appears (e.g. a permanently-missing
  // or misconfigured anchor), abort the flow rather than silently skipping to
  // completion — the provider persists 'aborted' and shows a replay hint.
  useEffect(() => {
    let active = true;
    let attempts = 0;
    let scrolled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRect(null);

    const scrollIntoViewOnce = () => {
      if (scrolled || Platform.OS !== 'web') return;
      const node = getTargetNode(step.targetId) as
        | { scrollIntoView?: (opts?: ScrollIntoViewOptions) => void }
        | null;
      if (node?.scrollIntoView) {
        node.scrollIntoView({ block: 'center', inline: 'center' });
        scrolled = true;
      }
    };

    const tryMeasure = () => {
      if (!active) return;
      // Bring an off-screen anchor into view before measuring so the cutout is
      // never rendered off-screen.
      scrollIntoViewOnce();
      void measureTarget(step.targetId).then((r) => {
        if (!active) return;
        if (r) {
          setRect(r);
          return;
        }
        attempts += 1;
        if (attempts >= MEASURE_MAX_ATTEMPTS) {
          abortFlow();
          return;
        }
        timer = setTimeout(tryMeasure, MEASURE_RETRY_MS);
      });
    };
    tryMeasure();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [step.targetId, step.route, measureTarget, getTargetNode, abortFlow]);

  // Re-measure on resize (web).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onResize = () => {
      void measureTarget(step.targetId).then((r) => r && setRect(r));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [step.targetId, measureTarget]);

  // Nav items animate width when the sidebar expands for onboarding — re-measure
  // after the expand transition so the cutout hugs the button, not collapsed chrome.
  useEffect(() => {
    if (!isNavOnboardingTarget(step.targetId)) return;
    const delays = [50, 150, 320, 500];
    const timers = delays.map((ms) =>
      setTimeout(() => {
        void measureTarget(step.targetId).then((r) => r && setRect(r));
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [step.targetId, measureTarget]);

  // Lock background scroll on web while the spotlight is active.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // onTargetPress: detect a click on the real (highlighted) element.
  useEffect(() => {
    if (!useCutout || advance !== 'onTargetPress') return;
    if (typeof document === 'undefined') return;
    const handler = (e: MouseEvent) => {
      const node = getTargetNode(step.targetId) as { contains?: (n: unknown) => boolean } | null;
      if (node?.contains && node.contains(e.target)) {
        notifyTargetPress(step.targetId);
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [useCutout, advance, step.targetId, getTargetNode, notifyTargetPress]);

  const calloutBody = (
    <View
      className="rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-5"
      style={{ width: useCutout && !narrowCallout ? CALLOUT_WIDTH : undefined }}
    >
      <Text className="text-white font-instrument-semibold text-lg mb-1.5">{step.title}</Text>
      <Text className="text-gray-300 font-instrument text-sm">{step.body}</Text>
      <StepControls
        key={progress ? progress.index : step.targetId}
        progress={progress}
        canGoBack={canGoBack}
        showNext={showNext}
        isLastStep={isLastStep}
        onBack={back}
        onNext={next}
        nextDisabled={nextDisabled}
        dwellMs={step.dwellMs}
        reducedMotion={reducedMotion}
        onSkip={onSkip}
      />
    </View>
  );

  // --- Mobile / native fallback: bottom callout card, no cutout ------------
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
          <View style={{ padding: 16, pointerEvents: 'auto' }}>{calloutBody}</View>
        </View>
      </Modal>
    );
  }

  // --- Web desktop: dim + rounded cutout via box-shadow --------------------
  // Render nothing (no dim, no click-blocker) until the target is measured, so
  // a still-loading or missing anchor never produces a flash or blocks clicks.
  if (!rect) return null;

  const { createPortal } = require('react-dom');

  const transition = reducedMotion ? 'none' : 'top 180ms ease, left 180ms ease, width 180ms ease, height 180ms ease';

  const hole = {
    top: rect.y - CUTOUT_PADDING,
    left: rect.x - CUTOUT_PADDING,
    width: rect.width + CUTOUT_PADDING * 2,
    height: rect.height + CUTOUT_PADDING * 2,
  };

  const calloutPos = positionCallout(rect, step.placement, vw, vh);
  // On narrow web the callout spans the width and docks to whichever edge keeps
  // it clear of the highlighted element (e.g. never covering a bottom-nav item).
  const dockToTop = narrowCallout && rect.y + rect.height / 2 > vh / 2;

  const content = (
    // The container is click-through (pointerEvents none). Only the blocker
    // panels and the callout re-enable pointer events, so the cutout hole stays
    // genuinely interactive and clicks reach the real element beneath it.
    <div style={{ position: 'fixed', inset: 0, zIndex: OVERLAY_Z, pointerEvents: 'none' }}>
      {/* Dim layer with a rounded hole. pointerEvents none so it never blocks. */}
      <div
        style={{
          position: 'fixed',
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          borderRadius: 12,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          transition,
        }}
      />

      {/* Click blockers (pointerEvents auto). For onTargetPress, leave the hole
          open so the real element receives the click; otherwise cover everything. */}
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

      {/* Callout — bottom-docked on narrow web, anchored to the target on desktop. */}
      <div
        style={
          narrowCallout
            ? {
                position: 'fixed',
                left: EDGE_PAD,
                right: EDGE_PAD,
                ...(dockToTop
                  ? { top: `calc(${EDGE_PAD}px + env(safe-area-inset-top, 0px))` }
                  : { bottom: `calc(${EDGE_PAD}px + env(safe-area-inset-bottom, 0px))` }),
                pointerEvents: 'auto',
              }
            : {
                position: 'fixed',
                top: calloutPos.top,
                left: calloutPos.left,
                width: CALLOUT_WIDTH,
                pointerEvents: 'auto',
              }
        }
      >
        {calloutBody}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
