import type { CampaignStatus, FlowChangeKind, FlowEditPolicy } from './types';

export const FLOW_STRUCTURE_LOCKED_LABEL = 'Structure locked';

export const FLOW_STRUCTURE_LOCKED_SIDEBAR_HINT =
  'Structure locked — edit settings inside nodes';

export const FLOW_STRUCTURE_LOCKED_TOAST =
  "Can't add or remove steps on a live campaign";

export const FLOW_STRUCTURE_LOCKED_TOOLTIP_TITLE = 'Structure is locked';

export const FLOW_STRUCTURE_LOCKED_TOOLTIP_BODY =
  'You can edit email copy, wait times, variants, and node settings. To add or remove steps, duplicate this campaign as a draft.';

const FLOW_LOCKED_MESSAGE = `${FLOW_STRUCTURE_LOCKED_TOOLTIP_TITLE}. ${FLOW_STRUCTURE_LOCKED_TOOLTIP_BODY}`;

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
