import type { CampaignStatus, FlowChangeKind, FlowEditPolicy } from './types';

/** @deprecated Use getFlowBadgeConfig(status).secondaryLabel */
export const FLOW_STRUCTURE_LOCKED_LABEL = 'Content only';

export const FLOW_BADGE_SECONDARY_RUNNING = 'Content only';
export const FLOW_BADGE_SECONDARY_PAUSED = 'Editable';
export const FLOW_BADGE_SECONDARY_STOPPED = 'Stopped';

export const FLOW_BADGE_TOOLTIP_RUNNING = 'Pause to add, remove, or move steps.';

export const FLOW_MODAL_PAUSE_TITLE = 'Pause campaign?';
export const FLOW_MODAL_PAUSE_BODY =
  'Adding or rearranging steps requires a paused campaign. Pausing temporarily holds sends. Active leads will continue when you resume.';
export const FLOW_MODAL_PAUSE_CONFIRM = 'Pause campaign';

export const FLOW_MODAL_DELETE_TITLE = 'Delete "{label}"?';
export const FLOW_MODAL_DELETE_BODY_PAUSED =
  'This may affect leads mid-sequence. This action cannot be undone.';
export const FLOW_MODAL_DELETE_BODY_DRAFT = 'This action cannot be undone.';

export const FLOW_MODAL_DELETE_EDGE_TITLE = 'Delete connection?';
export const FLOW_MODAL_DELETE_EDGE_BODY =
  'This may affect leads mid-sequence. This action cannot be undone.';

export const FLOW_CONNECT_TOOLTIP_RUNNING = 'Pause the campaign to connect steps';

export const FLOW_TOAST_STOPPED = "This campaign has stopped and can't be edited.";
export const FLOW_MODAL_STOPPED_TITLE = 'Campaign stopped';
export const FLOW_MODAL_STOPPED_BODY =
  'This campaign has stopped and the flow is read-only. You can review steps here, but changes cannot be saved.';
export const FLOW_MODAL_STOPPED_CONFIRM = 'Got it';
export const FLOW_TOAST_APPEND_REACTIVATED_ONE =
  '1 completed lead will receive the new follow-up when you resume.';
export const FLOW_TOAST_APPEND_REACTIVATED_MANY =
  '{count} completed leads will receive the new follow-up when you resume.';

export const FLOW_LOCKED_RUNNING_STRUCTURAL =
  'Pause the campaign to add or rearrange steps.';

export function formatFlowModalDeleteTitle(label: string): string {
  return FLOW_MODAL_DELETE_TITLE.replace('{label}', label);
}

export function formatFlowAppendReactivatedToast(count: number): string {
  if (count === 1) return FLOW_TOAST_APPEND_REACTIVATED_ONE;
  return FLOW_TOAST_APPEND_REACTIVATED_MANY.replace('{count}', String(count));
}

export type FlowBadgeConfig = {
  secondaryLabel: string;
  tooltip: string | null;
  showLockIcon: boolean;
};

export function isDraftCampaignStatus(status: CampaignStatus | null | undefined): boolean {
  return status === 'draft';
}

export function isFlowReadOnly(status: CampaignStatus | null | undefined): boolean {
  return status === 'stopped';
}

export function isContentEditAllowed(status: CampaignStatus | null | undefined): boolean {
  return status === 'draft' || status === 'running' || status === 'paused';
}

export function isStructuralEditAllowed(status: CampaignStatus | null | undefined): boolean {
  return status === 'draft' || status === 'paused';
}

/** @deprecated Use isStructuralEditAllowed / isFlowReadOnly instead */
export function isTopologyLockedForCampaignStatus(status: CampaignStatus | null | undefined): boolean {
  return status === 'running' || status === 'stopped';
}

export function getFlowBadgeConfig(status: CampaignStatus | null | undefined): FlowBadgeConfig | null {
  if (!status || status === 'draft') return null;

  switch (status) {
    case 'running':
      return {
        secondaryLabel: FLOW_BADGE_SECONDARY_RUNNING,
        tooltip: FLOW_BADGE_TOOLTIP_RUNNING,
        showLockIcon: true,
      };
    case 'paused':
      return {
        secondaryLabel: FLOW_BADGE_SECONDARY_PAUSED,
        tooltip: null,
        showLockIcon: false,
      };
    case 'stopped':
      return {
        secondaryLabel: FLOW_BADGE_SECONDARY_STOPPED,
        tooltip: null,
        showLockIcon: false,
      };
    default:
      return null;
  }
}

export function getFlowEditPolicy(
  status: CampaignStatus | null | undefined,
  changeKind: FlowChangeKind,
): FlowEditPolicy {
  if (status === 'stopped') {
    return {
      allowed: false,
      code: 'flow_locked',
      message: FLOW_TOAST_STOPPED,
    };
  }
  if (status === 'draft' || status === 'paused') {
    return { allowed: true };
  }
  if (status === 'running' && changeKind === 'content') {
    return { allowed: true };
  }
  if (status === 'running' && changeKind === 'none') {
    return { allowed: true };
  }
  return {
    allowed: false,
    code: 'flow_locked',
    message: FLOW_LOCKED_RUNNING_STRUCTURAL,
  };
}

export function assertFlowEditAllowed(
  status: CampaignStatus | null | undefined,
  changeKind: FlowChangeKind,
): FlowEditPolicy {
  return getFlowEditPolicy(status, changeKind);
}
