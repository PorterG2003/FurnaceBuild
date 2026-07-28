/**
 * Shape preview_replacement_target jsonb into the public Client API preview payload.
 * Derived fields (mode / allowed / disallowed_reason) use the same codes as the
 * write path so agents can branch without reimplementing RPC rules.
 */

export type ReplaceLeadPreviewLead = {
  id: string;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  mobile_phone_number: string | null;
  company_name: string | null;
  website: string | null;
  linkedin_url: string | null;
  company_linkedin_url: string | null;
  custom_lead_data: Record<string, unknown>;
  enrollment_id: string | null;
  enrollment_state: string | null;
  has_been_contacted: boolean;
  last_activity_at: string | null;
};

export type ReplaceLeadPreviewPayload = {
  email: string | null;
  mode: 'created' | 'attached';
  allowed: boolean;
  disallowed_reason: 'same_as_current_lead' | 'target_missing_enrollment' | null;
  match_count: number;
  matches_current_lead: boolean;
  blocked: boolean;
  block_reason: string | null;
  existing_lead: ReplaceLeadPreviewLead | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : value == null ? null : String(value);
}

export function buildReplaceLeadPreviewPayload(raw: unknown): ReplaceLeadPreviewPayload {
  const payload = asRecord(raw) ?? {};
  const rawLead = asRecord(payload.existingLead);
  const rawCustom = rawLead ? asRecord(rawLead.customLeadData) : null;
  const matchesCurrentLead = Boolean(payload.matchesOldLead);
  const existingLead: ReplaceLeadPreviewLead | null = rawLead
    ? {
        id: String(rawLead.id),
        email: asNullableString(rawLead.email),
        name: asNullableString(rawLead.name),
        first_name: asNullableString(rawLead.firstName),
        last_name: asNullableString(rawLead.lastName),
        phone_number: asNullableString(rawLead.phoneNumber),
        mobile_phone_number: asNullableString(rawLead.mobilePhoneNumber),
        company_name: asNullableString(rawLead.companyName),
        website: asNullableString(rawLead.website),
        linkedin_url: asNullableString(rawLead.linkedinUrl),
        company_linkedin_url: asNullableString(rawLead.companyLinkedinUrl),
        custom_lead_data: rawCustom ?? {},
        enrollment_id: asNullableString(rawLead.enrollmentId),
        enrollment_state: asNullableString(rawLead.enrollmentState),
        has_been_contacted: Boolean(rawLead.hasBeenContacted),
        last_activity_at: asNullableString(rawLead.lastActivityAt),
      }
    : null;

  const mode: 'created' | 'attached' = existingLead ? 'attached' : 'created';

  let disallowedReason: ReplaceLeadPreviewPayload['disallowed_reason'] = null;
  if (matchesCurrentLead) {
    disallowedReason = 'same_as_current_lead';
  } else if (existingLead && !existingLead.enrollment_id) {
    disallowedReason = 'target_missing_enrollment';
  }

  return {
    email: asNullableString(payload.email),
    mode,
    allowed: disallowedReason === null,
    disallowed_reason: disallowedReason,
    match_count: Number(payload.duplicateCount ?? 0),
    matches_current_lead: matchesCurrentLead,
    blocked: Boolean(payload.blocked),
    block_reason: asNullableString(payload.blockReason),
    existing_lead: existingLead,
  };
}
