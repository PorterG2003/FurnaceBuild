import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import type { FlowId } from '@/lib/onboarding/types';
import { useOnboardingOptional } from './context';

interface UseOnboardingTriggerOptions {
  /**
   * Readiness signal. The flow is requested once this is truthy. Pass the
   * screen's real readiness (e.g. `!isLoading`) so a spotlight only fires once
   * its anchors actually exist — this is the primary defense against a flow
   * starting before its targets render and then aborting. Defaults to true
   * (fire on mount).
   */
  when?: boolean;
}

/**
 * Screen-owned onboarding trigger. Call alongside `useOnboardingTarget` on a
 * screen so its flow fires the first time the screen is explored:
 *
 *   useOnboardingTrigger('inbox', { when: !initialLoading });
 *
 * The provider scheduler starts registered flows when the engine is idle and
 * guards pass. Safe to call outside an OnboardingProvider (no-op).
 *
 * Gated on focus (`useFocusEffect`), not just mount: our stack navigator
 * keeps prior screens mounted underneath the current one (for back-gesture
 * and transitions), so a mount-only registration would stay "ready" forever
 * once a screen had been visited once — letting an unrelated, earlier-
 * priority flow fire on whatever screen the user is actually looking at.
 * Tying registration to focus keeps it accurate to what's on screen.
 */
export function useOnboardingTrigger(id: FlowId, options: UseOnboardingTriggerOptions = {}) {
  const { when = true } = options;
  const onboarding = useOnboardingOptional();

  useFocusEffect(
    useCallback(() => {
      if (!onboarding) return;
      onboarding.registerFlowIntent(id, when);
      return () => onboarding.registerFlowIntent(id, false);
    }, [onboarding, id, when]),
  );
}
