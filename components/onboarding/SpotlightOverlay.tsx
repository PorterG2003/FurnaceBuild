import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import type { SpotlightStep } from '@/lib/onboarding/types';
import { useOnboarding } from './context';
import type { TargetRect } from './context';
import { StepControls } from './StepControls';

const CUTOUT_PADDING = 8;
const CALLOUT_WIDTH = 340;
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
}

export function SpotlightOverlay({ step, isLastStep, canGoBack }: SpotlightOverlayProps) {
  const {
    measureTarget,
    getTargetNode,
    notifyTargetPress,
    skipStep,
    next,
    back,
    dismissFlow,
    progress,
    reducedMotion,
  } = useOnboarding();
  const { width: vw, height: vh } = useWindowDimensions();
  const useCutout = Platform.OS === 'web' && vw >= LAYOUT_BREAKPOINT;

  const [rect, setRect] = useState<TargetRect | null>(null);
  const advance = step.advance ?? 'manual';
  // On the cutout path, an onTargetPress step has no Next button (the user must
  // press the highlighted element). The mobile fallback always shows Next.
  const showNext = !(useCutout && advance === 'onTargetPress');

  // Measure target with retry; skip the step if it never appears (e.g. wrong
  // route, or a desktop-only target on mobile).
  useEffect(() => {
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRect(null);

    const tryMeasure = () => {
      if (!active) return;
      void measureTarget(step.targetId).then((r) => {
        if (!active) return;
        if (r) {
          setRect(r);
          return;
        }
        attempts += 1;
        if (attempts >= MEASURE_MAX_ATTEMPTS) {
          skipStep();
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
  }, [step.targetId, step.route, measureTarget, skipStep]);

  // Re-measure on resize (web).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onResize = () => {
      void measureTarget(step.targetId).then((r) => r && setRect(r));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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
      style={{ width: useCutout ? CALLOUT_WIDTH : undefined }}
    >
      <Text className="text-white font-instrument-semibold text-lg mb-1.5">{step.title}</Text>
      <Text className="text-gray-300 font-instrument text-sm">{step.body}</Text>
      <StepControls
        progress={progress}
        canGoBack={canGoBack}
        showNext={showNext}
        isLastStep={isLastStep}
        onBack={back}
        onNext={next}
        onSkip={dismissFlow}
      />
    </View>
  );

  // --- Mobile / native fallback: bottom callout card, no cutout ------------
  if (!useCutout) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={dismissFlow}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <View style={{ padding: 16 }}>{calloutBody}</View>
        </View>
      </Modal>
    );
  }

  // --- Web desktop: dim + rounded cutout via box-shadow --------------------
  const { createPortal } = require('react-dom');

  const holeInteractive = advance === 'onTargetPress';
  const transition = reducedMotion ? 'none' : 'top 180ms ease, left 180ms ease, width 180ms ease, height 180ms ease';

  const hole = rect
    ? {
        top: rect.y - CUTOUT_PADDING,
        left: rect.x - CUTOUT_PADDING,
        width: rect.width + CUTOUT_PADDING * 2,
        height: rect.height + CUTOUT_PADDING * 2,
      }
    : null;

  const calloutPos = rect ? positionCallout(rect, step.placement, vw, vh) : null;

  const content = (
    <div style={{ position: 'fixed', inset: 0, zIndex: OVERLAY_Z }}>
      {/* Dim layer with a rounded hole. pointerEvents none so it never blocks. */}
      {hole ? (
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
      ) : (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Click blockers. For onTargetPress, leave the hole open so the real
          element receives the click; otherwise cover everything. */}
      {hole && holeInteractive ? (
        <>
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div style={{ position: 'fixed', top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div style={{ position: 'fixed', top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div style={{ position: 'fixed', top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0 }} />
      )}

      {/* Callout */}
      {calloutPos ? (
        <div style={{ position: 'fixed', top: calloutPos.top, left: calloutPos.left, width: CALLOUT_WIDTH }}>
          {calloutBody}
        </div>
      ) : null}
    </div>
  );

  return createPortal(content, document.body);
}
