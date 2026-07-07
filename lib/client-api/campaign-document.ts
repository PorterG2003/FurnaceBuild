import {
  computeFlowRevision,
  normalizeFlowData,
  validateForPhase,
  type CampaignFlowData,
  type CampaignStatus,
  type FlowValidationIssue,
} from '../campaigns/flow/index.js';
import {
  getCampaignCustomFieldKeys,
  getCampaignMappedStandardFieldKeys,
} from './flow-fields.js';
import type { Json } from '../supabase/types/database.js';

export type LaunchState = {
  ready: boolean;
  blocking_issues: FlowValidationIssue[];
  warnings: FlowValidationIssue[];
  checks: {
    has_name: boolean;
    has_flow: boolean;
    has_mailboxes: boolean;
    has_leads: boolean;
  };
};

export type LeadFieldState = {
  declared_custom_field_keys: string[];
  declared_standard_field_keys: string[];
  incomplete_lead_count: number;
  total_lead_count: number;
};

type CampaignLike = {
  name?: string | null;
  status?: CampaignStatus | null;
  flow_data?: Json | null;
};

export function buildLaunchState(
  campaign: CampaignLike,
  options: {
    mailboxCount: number;
    leadCount: number;
  },
): LaunchState {
  const flow = normalizeFlowData(campaign.flow_data ?? { nodes: [], edges: [] });
  const phaseValidation = validateForPhase(flow, 'launch');
  const hasName = !!campaign.name?.trim();
  const hasFlow = flow.nodes.length > 0;
  const hasMailboxes = options.mailboxCount > 0;
  const hasLeads = options.leadCount > 0;

  const readinessIssues: FlowValidationIssue[] = [];
  if (!hasName) {
    readinessIssues.push({
      path: 'name',
      code: 'campaign_name_required',
      message: 'Campaign name is required before launch.',
    });
  }
  if (!hasFlow) {
    readinessIssues.push({
      path: 'flow',
      code: 'campaign_flow_required',
      message: 'Campaign flow must be configured before launch.',
    });
  }
  if (!hasMailboxes) {
    readinessIssues.push({
      path: 'mailboxes',
      code: 'campaign_mailboxes_required',
      message: 'Assign at least one mailbox before launch.',
    });
  }

  const blocking_issues = [...phaseValidation.blockingIssues, ...readinessIssues];
  const warnings = phaseValidation.warnings;

  return {
    ready: blocking_issues.length === 0,
    blocking_issues,
    warnings,
    checks: {
      has_name: hasName,
      has_flow: hasFlow,
      has_mailboxes: hasMailboxes,
      has_leads: hasLeads,
    },
  };
}

export function buildLeadFieldState(
  flowData: Json | null | undefined,
  leadRows: Array<{ custom_lead_data?: Json | null }>,
): LeadFieldState {
  const declaredCustom = getCampaignCustomFieldKeys(flowData);
  const declaredStandard = getCampaignMappedStandardFieldKeys(flowData);
  const requiredStandard = declaredStandard.filter((key) => key !== 'email');

  let incomplete = 0;
  for (const lead of leadRows) {
    const customData = lead.custom_lead_data && typeof lead.custom_lead_data === 'object'
      ? lead.custom_lead_data as Record<string, unknown>
      : {};
    const missingCustom = declaredCustom.some((key) => {
      const value = customData[key];
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (missingCustom) {
      incomplete += 1;
      continue;
    }
    if (requiredStandard.length > 0) {
      // Standard fields live on lead row; caller should pass enriched rows when available.
      // For aggregate counts we only evaluate custom fields from custom_lead_data here.
    }
  }

  return {
    declared_custom_field_keys: declaredCustom,
    declared_standard_field_keys: declaredStandard,
    incomplete_lead_count: incomplete,
    total_lead_count: leadRows.length,
  };
}

export async function attachFlowRevision<T extends Record<string, unknown>>(
  campaign: T,
  flowData?: CampaignFlowData | null,
): Promise<T & { flow_revision: string }> {
  const flow = flowData ?? normalizeFlowData(campaign.flow_data ?? { nodes: [], edges: [] });
  return {
    ...campaign,
    flow_revision: await computeFlowRevision(flow),
  };
}

export function toCampaignListItem(row: Record<string, unknown>): Record<string, unknown> {
  const {
    flow_data: _flowData,
    schedule: _schedule,
    sending_interval_seconds: _interval,
    organization_id: _org,
    source: _source,
    smartlead_campaign_id: _smartlead,
    ...summary
  } = row;
  return summary;
}
