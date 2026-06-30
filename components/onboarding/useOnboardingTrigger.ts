import { useEffect, useRef } from 'react';
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
 * The provider's `requestFlow` applies all the guards (already seen, a flow
 * already active/pending, blocking overlay, disabled), and persistence ensures
 * it only ever runs once. Safe to call outside an OnboardingProvider (no-op).
 */
export function useOnboardingTrigger(id: FlowId, options: UseOnboardingTriggerOptions = {}) {
  const { when = true } = options;
  const onboarding = useOnboardingOptional();
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!onboarding) return;
    if (!when) return;
    if (requestedRef.current) return;
    requestedRef.current = true;
    onboarding.requestFlow(id);
  }, [onboarding, id, when]);
}
