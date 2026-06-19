import {
  buildNeutralSmartHandlingOptions,
  buildNotInterestedSmartHandlingOptions,
  buildOooSmartHandlingOptions,
  type SmartHandlingMetadata,
} from '@/lib/inbox/smartHandling';

function withDefaults(metadata: SmartHandlingMetadata): SmartHandlingMetadata {
  return {
    mode: metadata.mode ?? 'manual',
    category: metadata.category ?? null,
    primary_message: metadata.primary_message ?? null,
    primary: metadata.primary ?? null,
    alternatives: metadata.alternatives ?? [],
    follow_ups: metadata.follow_ups ?? [],
    return_date: metadata.return_date ?? null,
    suggested_reply: metadata.suggested_reply ?? null,
    suggested_referral: metadata.suggested_referral ?? null,
    header_mismatch: metadata.header_mismatch ?? false,
  };
}

export function buildSeedInterestedMetadata(): SmartHandlingMetadata {
  return withDefaults({
    mode: 'manual',
    category: 'Interested',
    primary_message: 'This looks like an interested reply.',
    primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
    alternatives: [
      { action: 'mark_interested', label: 'Interested only' },
      { action: 'reply_only', label: 'Reply only' },
    ],
    suggested_reply:
      'Thanks for the reply. Happy to share more details and find a time that works for you.',
  });
}

export function buildSeedNeutralMetadata(): SmartHandlingMetadata {
  return withDefaults({
    mode: 'manual',
    category: 'Neutral',
    ...buildNeutralSmartHandlingOptions(),
  });
}

export function buildSeedNotInterestedMetadata(params?: {
  subject?: string | null;
  bodyText?: string | null;
}): SmartHandlingMetadata {
  const notInterestedOptions = buildNotInterestedSmartHandlingOptions({
    subject: params?.subject ?? null,
    bodyText: params?.bodyText ?? 'Not interested right now. Please remove me from your list.',
  });
  return withDefaults({
    mode: 'manual',
    category: 'Not Interested',
    ...notInterestedOptions,
  });
}

export function buildSeedOooDatedMetadata(returnDate: string): SmartHandlingMetadata {
  const oooOptions = buildOooSmartHandlingOptions(returnDate);
  return withDefaults({
    mode: 'manual',
    category: 'Auto Reply',
    ...oooOptions,
  });
}

export function buildSeedOooNoDateMetadata(): SmartHandlingMetadata {
  const oooOptions = buildOooSmartHandlingOptions(null);
  return withDefaults({
    mode: 'manual',
    category: 'Auto Reply',
    ...oooOptions,
  });
}

export function buildSeedWrongContactMetadata(referralEmail: string): SmartHandlingMetadata {
  return withDefaults({
    mode: 'manual',
    category: 'Interested',
    primary_message: 'This reply came from a different contact. Consider replacing the lead.',
    primary: { action: 'replace_lead', label: 'Replace + forward with message' },
    alternatives: [
      { action: 'mark_interested_reply', label: 'Interested + reply' },
      { action: 'mark_interested', label: 'Interested only' },
    ],
    suggested_reply:
      'Thanks for the reply. Happy to share more details and find a time that works for you.',
    suggested_referral: {
      email: referralEmail,
      name: null,
      reason: 'wrong_contact',
    },
    header_mismatch: true,
  });
}

export function buildSeedAiMetadata(category: string): SmartHandlingMetadata {
  return withDefaults({
    mode: 'ai',
    category,
    primary_message: `AI categorized this reply as ${category}.`,
  });
}
