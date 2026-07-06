import { useEffect, useRef } from 'react';
import type { OnboardingHostId } from '@/lib/onboarding/onboardingHosts';
import type { TargetId } from '@/lib/onboarding/types';
import { useOnboardingHostActive, useOnboardingOptional } from './context';

interface UseOnboardingHostLifecycleArgs {
  hostId: OnboardingHostId;
  /**
   * Secondary guard ANDed with the step-driven `hostActive` check (e.g. the
   * screen's own platform match). `hostId` on the active step is already the
   * primary, authoritative signal — this is a belt-and-suspenders gate so a
   * screen never opens its modal host from a flow authored for a different
   * surface. Defaults to true.
   */
  enabled?: boolean;
  /** Whether the host surface is currently open. */
  isOpen: boolean;
  /** Opens the host surface. */
  open: () => void;
  /** Closes the host surface (called when the host's steps finish). */
  close?: () => void;
  /**
   * The screen-level target the user presses to open the host (the step that
   * precedes the host's own steps). Once the host opens on that step, it is
   * advanced via `notifyTargetPress` so the flow continues cross-platform.
   */
  openTriggerTargetId?: TargetId;
}

export interface OnboardingHostLifecycle {
  /** True while the active step targets this host: pin it open + stop blocking. */
  hostActive: boolean;
}

/**
 * Screen-level coordination for a modal onboarding host: auto-opens the surface
 * while its steps are active, advances the open-trigger step once it opens, and
 * closes it again when the host's steps finish. Returns `hostActive` so the
 * screen can pin the surface (dismiss-locked) and mark it non-blocking.
 */
export function useOnboardingHostLifecycle({
  hostId,
  enabled = true,
  isOpen,
  open,
  close,
  openTriggerTargetId,
}: UseOnboardingHostLifecycleArgs): OnboardingHostLifecycle {
  const ctx = useOnboardingOptional();
  const hostActive = useOnboardingHostActive(hostId) && enabled;
  const currentTargetId =
    ctx?.currentStep?.kind === 'spotlight' ? ctx.currentStep.targetId : null;
  const notifyTargetPress = ctx?.notifyTargetPress;

  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(close);
  closeRef.current = close;

  // Auto-open the host while one of its steps is active.
  useEffect(() => {
    if (hostActive && !isOpen) openRef.current();
  }, [hostActive, isOpen]);

  // Advance the open-trigger step once the host has actually opened. Guarded so
  // it fires once per visit to the trigger step (not on every re-render).
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!openTriggerTargetId) return;
    const isTriggerStep = currentTargetId === openTriggerTargetId;
    if (!isTriggerStep) {
      notifiedRef.current = false;
      return;
    }
    if (isOpen && !notifiedRef.current) {
      notifiedRef.current = true;
      notifyTargetPress?.(openTriggerTargetId);
    }
  }, [openTriggerTargetId, currentTargetId, isOpen, notifyTargetPress]);

  // Close the host once its steps finish (only when we had pinned it open).
  const prevHostActiveRef = useRef(hostActive);
  useEffect(() => {
    if (prevHostActiveRef.current && !hostActive && isOpen) {
      closeRef.current?.();
    }
    prevHostActiveRef.current = hostActive;
  }, [hostActive, isOpen]);

  return { hostActive };
}
