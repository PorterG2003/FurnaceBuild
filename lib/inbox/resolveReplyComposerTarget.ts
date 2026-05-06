export interface ResolveReplyComposerTargetInput {
  message: {
    direction: 'sent' | 'received';
    from_email: string;
    from_name: string | null;
  };
  lastReceived: {
    from_email: string;
    from_name: string | null;
  } | null;
  currentLeadEmail: string | null;
  currentLeadName: string | null;
}

export interface ResolveReplyComposerTargetResult {
  toEmail: string;
  toName: string;
}

function normalizeString(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function resolveReplyComposerTarget(
  input: ResolveReplyComposerTargetInput
): ResolveReplyComposerTargetResult {
  const preferredLeadEmail = normalizeString(input.currentLeadEmail);
  const preferredLeadName = normalizeString(input.currentLeadName);
  const fallbackEmail =
    input.message.direction === 'received'
      ? normalizeString(input.message.from_email)
      : normalizeString(input.lastReceived?.from_email);
  const fallbackName =
    input.message.direction === 'received'
      ? normalizeString(input.message.from_name)
      : normalizeString(input.lastReceived?.from_name);

  return {
    toEmail: preferredLeadEmail || fallbackEmail,
    toName: preferredLeadEmail ? preferredLeadName : fallbackName,
  };
}
