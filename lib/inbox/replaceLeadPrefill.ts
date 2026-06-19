import type { ReplacementReason } from '@/lib/supabase/types';
import type { SmartHandlingMetadata } from './smartHandling';

export interface ReplaceLeadPrefill {
  email?: string | null;
  name?: string | null;
  reason?: ReplacementReason | null;
  reasonNote?: string | null;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildReplaceLeadPrefill(params: {
  metadata: SmartHandlingMetadata | null;
  inboundFromEmail?: string | null;
}): ReplaceLeadPrefill | null {
  const { metadata, inboundFromEmail } = params;
  if (!metadata) return null;

  const referral = metadata.suggested_referral ?? null;
  const fallbackEmail = metadata.header_mismatch ? normalizeNullableString(inboundFromEmail) : null;
  const email = normalizeNullableString(referral?.email) ?? fallbackEmail;
  const name = normalizeNullableString(referral?.name);
  const reason =
    referral?.reason ?? (metadata.header_mismatch ? ('wrong_contact' satisfies ReplacementReason) : null);
  const reasonNote = normalizeNullableString(metadata.primary_message);

  if (!email && !name && !reason && !reasonNote) {
    return null;
  }

  return {
    email,
    name,
    reason,
    reasonNote,
  };
}
