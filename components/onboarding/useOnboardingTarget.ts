import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { TargetSurface } from '@/lib/onboarding/targetRegistry';
import type { TargetId } from '@/lib/onboarding/types';
import { useOnboardingOptional } from './context';

export interface UseOnboardingTargetOptions {
  enabled?: boolean;
  /** Registry surface this ref belongs to. Defaults to the global viewport. */
  surface?: TargetSurface;
}

/**
 * Marks a View as a spotlight anchor. Spread the returned ref onto any `View`:
 *
 *   const ref = useOnboardingTarget(TARGETS.navItems);
 *   <View ref={ref}>...</View>
 *
 * Pass `{ surface }` when the same TargetId also exists on another render
 * surface (e.g. a modal host), so the two refs register independently instead
 * of the last one overwriting the other:
 *
 *   const ref = useOnboardingTarget(TARGETS.inboxActionClose, {
 *     enabled: visible,
 *     surface: 'inboxMessageActions',
 *   });
 *
 * Safe to call outside an OnboardingProvider (no-op), so shared components can
 * adopt it without forcing the provider everywhere.
 */
export function useOnboardingTarget(
  id: TargetId,
  options: boolean | UseOnboardingTargetOptions = true,
) {
  const { enabled = true, surface } = typeof options === 'boolean' ? { enabled: options } : options;
  const ref = useRef<View | null>(null);
  const onboarding = useOnboardingOptional();

  useEffect(() => {
    if (!onboarding || !enabled) return;
    const unregister = onboarding.registerTarget(id, ref, surface);
    return unregister;
  }, [enabled, id, onboarding, surface]);

  return ref;
}
