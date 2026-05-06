import type { Lead, ReplacementReason } from '@/lib/supabase/types';
import { getLeadDisplayName } from './utils';

export type LeadReplacementRole = 'old' | 'new';

export interface LeadReplacementSummary {
  replacementId: string;
  role: LeadReplacementRole;
  counterpartLeadId: string;
  counterpartName: string | null;
  counterpartEmail: string | null;
  counterpartLabel: string | null;
  reason: ReplacementReason;
  reasonNote: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface LeadReplacementRow {
  id: string;
  old_lead_id: string;
  new_lead_id: string;
  reason: ReplacementReason;
  reason_note: string | null;
  created_at: string;
  completed_at: string | null;
}

export type LeadReplacementCounterpart = Pick<
  Lead,
  'id' | 'name' | 'first_name' | 'last_name' | 'email'
>;

export interface LeadReplacementProjection {
  replacement_role: LeadReplacementRole | null;
  replacement_counterpart_lead_id: string | null;
  replacement_counterpart_name: string | null;
  replacement_counterpart_email: string | null;
  replacement_counterpart_label: string | null;
  replacement_reason: ReplacementReason | null;
  replacement_reason_note: string | null;
  replacement_completed_at: string | null;
}

export function buildLeadReplacementSummariesByLeadIds(params: {
  leadIds: string[];
  replacements: LeadReplacementRow[];
  counterpartLeadsById: Map<string, LeadReplacementCounterpart>;
}): Record<string, LeadReplacementSummary> {
  const uniqueLeadIds = new Set(params.leadIds.filter(Boolean));
  const summaryByLeadId: Record<string, LeadReplacementSummary> = {};

  for (const replacement of params.replacements) {
    if (uniqueLeadIds.has(replacement.old_lead_id)) {
      const counterpart = params.counterpartLeadsById.get(replacement.new_lead_id) ?? null;
      summaryByLeadId[replacement.old_lead_id] = {
        replacementId: replacement.id,
        role: 'old',
        counterpartLeadId: replacement.new_lead_id,
        counterpartName: counterpart?.name ?? null,
        counterpartEmail: counterpart?.email ?? null,
        counterpartLabel: getLeadDisplayName((counterpart as Lead | null) ?? null),
        reason: replacement.reason,
        reasonNote: replacement.reason_note,
        completedAt: replacement.completed_at,
        createdAt: replacement.created_at,
      };
    }

    if (uniqueLeadIds.has(replacement.new_lead_id)) {
      const counterpart = params.counterpartLeadsById.get(replacement.old_lead_id) ?? null;
      summaryByLeadId[replacement.new_lead_id] = {
        replacementId: replacement.id,
        role: 'new',
        counterpartLeadId: replacement.old_lead_id,
        counterpartName: counterpart?.name ?? null,
        counterpartEmail: counterpart?.email ?? null,
        counterpartLabel: getLeadDisplayName((counterpart as Lead | null) ?? null),
        reason: replacement.reason,
        reasonNote: replacement.reason_note,
        completedAt: replacement.completed_at,
        createdAt: replacement.created_at,
      };
    }
  }

  return summaryByLeadId;
}

export function applyLeadReplacementSummary(
  replacementSummary: LeadReplacementSummary | null | undefined
): LeadReplacementProjection {
  if (!replacementSummary) {
    return {
      replacement_role: null,
      replacement_counterpart_lead_id: null,
      replacement_counterpart_name: null,
      replacement_counterpart_email: null,
      replacement_counterpart_label: null,
      replacement_reason: null,
      replacement_reason_note: null,
      replacement_completed_at: null,
    };
  }

  return {
    replacement_role: replacementSummary.role,
    replacement_counterpart_lead_id: replacementSummary.counterpartLeadId,
    replacement_counterpart_name: replacementSummary.counterpartName,
    replacement_counterpart_email: replacementSummary.counterpartEmail,
    replacement_counterpart_label: replacementSummary.counterpartLabel,
    replacement_reason: replacementSummary.reason,
    replacement_reason_note: replacementSummary.reasonNote,
    replacement_completed_at: replacementSummary.completedAt,
  };
}
