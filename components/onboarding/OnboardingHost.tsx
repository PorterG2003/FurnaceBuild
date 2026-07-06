import { useRef, type ReactNode, type RefObject } from 'react';
import { View, type ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import type { OnboardingHostId } from '@/lib/onboarding/onboardingHosts';
import { useOnboardingHostActive, useOnboardingOptional } from './context';
import { useRegisterOnboardingHost } from './overlayPresence';
import { SpotlightOverlay } from './SpotlightOverlay';

interface OnboardingHostProps {
  hostId: OnboardingHostId;
  /** Whether the surface (e.g. a sheet) is currently mounted/visible. */
  active: boolean;
  children: ReactNode;
  /** The scrollable region inside the host, used for scroll-into-view. */
  scrollRef?: RefObject<ScrollView | null>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Wraps a modal surface so onboarding spotlight steps targeting elements inside
 * it render an in-container cutout (rather than the app-root viewport overlay).
 *
 * The wrapper owns its own container ref: the spotlight measures targets relative
 * to this `View`, so the dim/cutout stays scoped to the sheet. It registers the
 * host while `active` (without blocking global onboarding) and only renders the
 * spotlight when the current step actually targets this host.
 */
export function OnboardingHost({ hostId, active, children, scrollRef, style }: OnboardingHostProps) {
  const containerRef = useRef<View | null>(null);
  const ctx = useOnboardingOptional();
  useRegisterOnboardingHost(hostId, active);
  const hostStepActive = useOnboardingHostActive(hostId);

  const step = ctx?.currentStep ?? null;
  const showSpotlight = active && hostStepActive && step?.kind === 'spotlight';

  const progress = ctx?.progress ?? null;
  const isLastStep = progress ? progress.index === progress.total - 1 : false;
  const canGoBack = progress ? progress.index > 0 : false;
  const onSkip = ctx?.currentFlowMandatory ? undefined : ctx?.dismissFlow;

  return (
    <View ref={containerRef} collapsable={false} style={[{ position: 'relative' }, style]}>
      {children}
      {showSpotlight && step?.kind === 'spotlight' ? (
        <SpotlightOverlay
          key={hostId}
          step={step}
          isLastStep={isLastStep}
          canGoBack={canGoBack}
          onSkip={onSkip}
          scope="container"
          containerRef={containerRef}
          scrollRef={scrollRef}
        />
      ) : null}
    </View>
  );
}
