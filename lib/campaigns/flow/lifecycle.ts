import type { CampaignStatus, FlowChangeKind, FlowEditPolicy } from './types';

const FLOW_LOCKED_MESSAGE =
  'This campaign is no longer a draft, so structural flow changes are locked. You can still edit copy, variants, timing, and node configuration.';

export function isDraftCampaignStatus(status: CampaignStatus | null | undefined): boolean {
  return status === 'draft';
}

export function isTopologyLockedForCampaignStatus(status: CampaignStatus | null | undefined): boolean {
  return !!status && status !== 'draft';
}

export function getFlowEditPolicy(
  status: CampaignStatus | null | undefined,
  changeKind: FlowChangeKind,
): FlowEditPolicy {
  if (!isTopologyLockedForCampaignStatus(status)) {
    return { allowed: true };
  }
  if (changeKind === 'structural') {
    return {
      allowed: false,
      code: 'flow_locked',
      message: FLOW_LOCKED_MESSAGE,
    };
  }
  return { allowed: true };
}

export function assertFlowEditAllowed(
  status: CampaignStatus | null | undefined,
  changeKind: FlowChangeKind,
): FlowEditPolicy {
  return getFlowEditPolicy(status, changeKind);
}
