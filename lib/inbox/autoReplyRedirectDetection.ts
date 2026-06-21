function normalizeEmail(value: string | null | undefined): string | null {
  const match = value?.trim().match(/[A-Z0-9][A-Z0-9._%+-]*@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0].toLowerCase() ?? null;
}

function trimReferralName(value: string): string | null {
  let trimmed = value.trim().replace(/[.,;:!?]+$/, '').trim();
  trimmed = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  trimmed = trimmed.replace(/[(\[,]+$/, '').trim();
  return trimmed || null;
}

export function extractEmailCandidates(bodyText: string | null | undefined): string[] {
  if (!bodyText) return [];
  const matches = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [
    ...new Set(
      matches
        .map((value) => normalizeEmail(value))
        .filter((value): value is string => !!value),
    ),
  ];
}

export function extractReferralNameNearEmail(
  bodyText: string | null | undefined,
  referralEmail: string | null | undefined,
): string | null {
  if (!bodyText || !referralEmail) return null;

  const emailNorm = referralEmail.trim().toLowerCase();
  const emailIndex = bodyText.toLowerCase().indexOf(emailNorm);
  if (emailIndex < 0) return null;

  const before = bodyText.slice(0, emailIndex).trimEnd().replace(/\s+at\s*$/i, '');

  const phraseMatch = before.match(
    /(?:please\s+)?(?:contact|reach out to|email|direct(?:\s+any)?(?:\s+questions)?\s+to)\s+(.+)$/i,
  );
  if (phraseMatch) return trimReferralName(phraseMatch[1]);

  const nameMatch = before.match(/([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)+)\s*$/);
  if (nameMatch) return trimReferralName(nameMatch[1]);

  return null;
}

export function detectAutoReplyRedirectSignals(params: {
  fromEmail?: string | null;
  leadEmail?: string | null;
  bodyText?: string | null;
}): {
  headerMismatch: boolean;
  referralEmail: string | null;
  referralName: string | null;
  shouldReplaceLead: boolean;
} {
  const normalizedFrom = normalizeEmail(params.fromEmail);
  const normalizedLead = normalizeEmail(params.leadEmail);
  const headerMismatch = !!normalizedFrom && !!normalizedLead && normalizedFrom !== normalizedLead;
  const referralEmail =
    extractEmailCandidates(params.bodyText ?? null).find(
      (candidate) => candidate !== normalizedFrom && candidate !== normalizedLead,
    ) ?? null;
  const referralName = extractReferralNameNearEmail(params.bodyText ?? null, referralEmail);

  return {
    headerMismatch,
    referralEmail,
    referralName,
    shouldReplaceLead: headerMismatch || !!referralEmail,
  };
}

export function resolveSuggestedReferralName(params: {
  referralEmail: string | null;
  referralName: string | null;
  headerMismatch: boolean;
  fromName: string | null;
}): string | null {
  if (params.referralEmail) return params.referralName;
  if (params.headerMismatch) {
    const trimmed = params.fromName?.trim();
    return trimmed || null;
  }
  return null;
}
