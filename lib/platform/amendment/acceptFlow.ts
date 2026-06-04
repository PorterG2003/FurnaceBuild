import { normalizeAgreementType, type AgreementType } from '@/lib/platform/contract/terms';
import {
  getProposalPlanPreset,
  isProposalPlanTier,
} from '@/lib/platform/contract/proposalPlans';

export type AmendmentAcceptFlowKind = 'terms_only' | 'full_proposal';
export type AmendmentBillingChangeKind = 'upgrade' | 'downgrade' | 'unchanged';
export type PendingAmendmentStatus = 'pending_acceptance' | 'pending_payment';

export type ContractSnapshot = {
  monthly_retainer_cents: number;
  agreement_type: AgreementType;
  proposal_snapshot_json: Record<string, unknown>;
};

function normalizeSnapshotFields(value: Record<string, unknown>) {
  const planTier = isProposalPlanTier(value.plan_tier) ? value.plan_tier : null;
  const preset = planTier ? getProposalPlanPreset(planTier) : null;
  return {
    plan_tier: planTier,
    proposal_title:
      typeof value.proposal_title === 'string' && value.proposal_title.trim()
        ? value.proposal_title.trim()
        : (preset?.proposalTitle ?? null),
    managed_outreach_volume:
      typeof value.managed_outreach_volume === 'number' ? value.managed_outreach_volume : null,
    managed_inbox_count:
      typeof value.managed_inbox_count === 'number' ? value.managed_inbox_count : null,
    website_traffic_sourcing_enabled: Boolean(value.website_traffic_sourcing_enabled),
    reply_handling_enabled: Boolean(value.reply_handling_enabled),
  };
}

function proposalSnapshotChanged(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): boolean {
  const left = normalizeSnapshotFields(current);
  const right = normalizeSnapshotFields(proposed);
  return (
    left.plan_tier !== right.plan_tier ||
    left.proposal_title !== right.proposal_title ||
    left.managed_outreach_volume !== right.managed_outreach_volume ||
    left.managed_inbox_count !== right.managed_inbox_count ||
    left.website_traffic_sourcing_enabled !== right.website_traffic_sourcing_enabled ||
    left.reply_handling_enabled !== right.reply_handling_enabled
  );
}

export function resolveAmendmentAcceptFlow(
  current: ContractSnapshot,
  proposed: ContractSnapshot,
): AmendmentAcceptFlowKind {
  const currentAgreement = normalizeAgreementType(current.agreement_type);
  const proposedAgreement = normalizeAgreementType(proposed.agreement_type);

  if (current.monthly_retainer_cents !== proposed.monthly_retainer_cents) {
    return 'full_proposal';
  }
  if (currentAgreement !== proposedAgreement) {
    return 'full_proposal';
  }
  if (proposalSnapshotChanged(current.proposal_snapshot_json, proposed.proposal_snapshot_json)) {
    return 'full_proposal';
  }
  return 'terms_only';
}

export function resolveAmendmentBillingChangeKind(
  current: ContractSnapshot,
  proposed: ContractSnapshot,
): AmendmentBillingChangeKind {
  if (proposed.monthly_retainer_cents > current.monthly_retainer_cents) {
    return 'upgrade';
  }
  if (proposed.monthly_retainer_cents < current.monthly_retainer_cents) {
    return 'downgrade';
  }
  return 'unchanged';
}

export function buildAmendmentAcceptUrl(amendmentId: string) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://build.getfurnace.io';
  return `${origin}/accept-account-amendment/${amendmentId}`;
}

export function resolveAmendmentAcceptFlowFromBilling(
  billing: {
    monthly_retainer_cents: number;
    agreement_type?: AgreementType | null;
    proposal_snapshot_json?: Record<string, unknown> | null;
  },
  proposed: ContractSnapshot,
): AmendmentAcceptFlowKind {
  return resolveAmendmentAcceptFlow(
    {
      monthly_retainer_cents: billing.monthly_retainer_cents,
      agreement_type: normalizeAgreementType(billing.agreement_type ?? 'managed_services_agreement'),
      proposal_snapshot_json: billing.proposal_snapshot_json ?? {},
    },
    proposed,
  );
}

export function resolveAmendmentBillingChangeKindFromBilling(
  billing: {
    monthly_retainer_cents: number;
    agreement_type?: AgreementType | null;
    proposal_snapshot_json?: Record<string, unknown> | null;
  },
  proposed: ContractSnapshot,
): AmendmentBillingChangeKind {
  return resolveAmendmentBillingChangeKind(
    {
      monthly_retainer_cents: billing.monthly_retainer_cents,
      agreement_type: normalizeAgreementType(billing.agreement_type ?? 'managed_services_agreement'),
      proposal_snapshot_json: billing.proposal_snapshot_json ?? {},
    },
    proposed,
  );
}

export function isPendingAmendmentStatus(status: string | null | undefined): status is PendingAmendmentStatus {
  return status === 'pending_acceptance' || status === 'pending_payment';
}
