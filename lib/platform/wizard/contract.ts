import type { ProposalPlanTier } from '@/lib/platform/contract/proposalPlans';
import { getProposalPlanPreset } from '@/lib/platform/contract/proposalPlans';
import {
  renderPlatformTermsMarkdown,
  type AgreementType,
} from '@/lib/platform/contract/terms';

type BuildContractProposalSnapshotParams = {
  agreementType: AgreementType;
  planTier: ProposalPlanTier;
  clientLogoUrl?: string | null;
  clientLogoScale?: number;
  clientLogoOffsetX?: number;
  websiteTrafficSourcingEnabled?: boolean;
  replyHandlingEnabled?: boolean;
  managedOutreachVolume?: number | null;
  managedInboxCount?: number | null;
};

export function buildContractProposalSnapshot({
  agreementType,
  planTier,
  clientLogoUrl,
  clientLogoScale = 1,
  clientLogoOffsetX = 0,
  websiteTrafficSourcingEnabled = false,
  replyHandlingEnabled = false,
  managedOutreachVolume = null,
  managedInboxCount = null,
}: BuildContractProposalSnapshotParams) {
  if (agreementType !== 'managed_services_agreement') {
    return {
      proposal_title: 'Furnace Platform Access',
      client_logo_url: clientLogoUrl?.trim() ?? '',
      client_logo_scale: clientLogoScale,
      client_logo_offset_x: clientLogoOffsetX,
      plan_tier: planTier,
      website_traffic_sourcing_enabled: false,
      reply_handling_enabled: false,
      managed_outreach_volume: null,
      managed_inbox_count: null,
    };
  }

  return {
    proposal_title: getProposalPlanPreset(planTier).proposalTitle,
    client_logo_url: clientLogoUrl?.trim() ?? '',
    client_logo_scale: clientLogoScale,
    client_logo_offset_x: clientLogoOffsetX,
    plan_tier: planTier,
    website_traffic_sourcing_enabled: websiteTrafficSourcingEnabled,
    reply_handling_enabled: replyHandlingEnabled,
    managed_outreach_volume: managedOutreachVolume,
    managed_inbox_count: managedInboxCount,
  };
}

export function renderContractTermsPreview(params: {
  sourceMarkdown: string;
  proposedAccountName: string | null;
  monthlyRetainerCents: number;
  proposalSnapshot: Record<string, unknown>;
}) {
  return renderPlatformTermsMarkdown(params);
}
