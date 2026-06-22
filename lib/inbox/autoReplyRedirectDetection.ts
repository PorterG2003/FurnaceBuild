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

export function normalizeBodyTextForExtraction(bodyText: string): string {
  return bodyText.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
}

function sliceBeforeReferralEmail(bodyText: string, referralEmail: string): string | null {
  const normalized = normalizeBodyTextForExtraction(bodyText);
  const emailNorm = referralEmail.trim().toLowerCase();
  const emailIndex = normalized.toLowerCase().indexOf(emailNorm);
  if (emailIndex < 0) return null;
  return normalized.slice(0, emailIndex).trimEnd().replace(/\s+at\s*$/i, '').trimEnd();
}

export function extractEmailCandidates(bodyText: string | null | undefined): string[] {
  if (!bodyText) return [];
  const normalized = normalizeBodyTextForExtraction(bodyText);
  const matches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [
    ...new Set(
      matches
        .map((value) => normalizeEmail(value))
        .filter((value): value is string => !!value),
    ),
  ];
}

export function extractReferralNamePhraseNearEmail(
  bodyText: string | null | undefined,
  referralEmail: string | null | undefined,
): string | null {
  if (!bodyText || !referralEmail) return null;

  const before = sliceBeforeReferralEmail(bodyText, referralEmail);
  if (!before) return null;

  const phraseMatch = before.match(
    /(?:please\s+)?(?:contact|reach out to|email|direct(?:\s+any)?(?:\s+[^.!?\n]{0,80})?\s+to)\s+(.+)$/i,
  );
  if (phraseMatch) return phraseMatch[1].trim();

  const nameMatch = before.match(/([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)+)\s*$/);
  if (nameMatch) return nameMatch[1].trim();

  const toMatch = before.match(/\bto\s+(.+)$/i);
  return toMatch?.[1]?.trim() ?? null;
}

export function extractReferralNameNearEmail(
  bodyText: string | null | undefined,
  referralEmail: string | null | undefined,
): string | null {
  const phrase = extractReferralNamePhraseNearEmail(bodyText, referralEmail);
  return phrase ? trimReferralName(phrase) : null;
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
  const bodyText = normalizeBodyTextForExtraction(params.bodyText ?? '');
  const referralEmail =
    extractEmailCandidates(bodyText).find(
      (candidate) => candidate !== normalizedFrom && candidate !== normalizedLead,
    ) ?? null;
  const referralName = extractReferralNameNearEmail(bodyText, referralEmail);

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
