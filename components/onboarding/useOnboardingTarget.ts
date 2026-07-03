import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { TargetId } from '@/lib/onboarding/types';
import { useOnboardingOptional } from './context';

/**
 * Marks a View as a spotlight anchor. Spread the returned ref onto any `View`:
 *
 *   const ref = useOnboardingTarget(TARGETS.navItems);
 *   <View ref={ref}>...</View>
 *
 * Safe to call outside an OnboardingProvider (no-op), so shared components can
 * adopt it without forcing the provider everywhere.
 */
export function useOnboardingTarget(id: TargetId) {
  const ref = useRef<View | null>(null);
  const onboarding = useOnboardingOptional();

  useEffect(() => {
    if (!onboarding) return;
    const unregister = onboarding.registerTarget(id, ref);
    return unregister;
  }, [id, onboarding]);

  return ref;
}
