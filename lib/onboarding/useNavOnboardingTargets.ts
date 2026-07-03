import { useOnboardingTarget } from '@/components/onboarding/useOnboardingTarget';
import { TARGETS, type TargetId } from './types';

export const NAV_ONBOARDING_TARGET_IDS: ReadonlySet<TargetId> = new Set([
  TARGETS.navCampaigns,
  TARGETS.navMetrics,
  TARGETS.navInbox,
  TARGETS.navLeads,
  TARGETS.navSenders,
  TARGETS.navSettings,
]);

export function isNavOnboardingTarget(id: TargetId): boolean {
  return NAV_ONBOARDING_TARGET_IDS.has(id);
}

/** Maps main app routes to per-item nav spotlight anchor ids. */
export const NAV_ROUTE_TARGETS: Record<string, TargetId> = {
  '/campaigns': TARGETS.navCampaigns,
  '/metrics': TARGETS.navMetrics,
  '/inbox': TARGETS.navInbox,
  '/leads': TARGETS.navLeads,
  '/senders': TARGETS.navSenders,
  '/account': TARGETS.navSettings,
};

/** One ref per nav item — safe to call from NavBar or BottomNavBar (only one mounts). */
export function useNavOnboardingTargets() {
  return {
    campaigns: useOnboardingTarget(TARGETS.navCampaigns),
    metrics: useOnboardingTarget(TARGETS.navMetrics),
    inbox: useOnboardingTarget(TARGETS.navInbox),
    leads: useOnboardingTarget(TARGETS.navLeads),
    senders: useOnboardingTarget(TARGETS.navSenders),
    settings: useOnboardingTarget(TARGETS.navSettings),
  };
}

export function navTargetRefForPath(
  path: string,
  refs: ReturnType<typeof useNavOnboardingTargets>,
) {
  switch (path) {
    case '/campaigns':
      return refs.campaigns;
    case '/metrics':
      return refs.metrics;
    case '/inbox':
      return refs.inbox;
    case '/leads':
      return refs.leads;
    case '/senders':
      return refs.senders;
    case '/account':
      return refs.settings;
    default:
      return undefined;
  }
}
