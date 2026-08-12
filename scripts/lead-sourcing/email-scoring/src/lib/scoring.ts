import { isBusinessDomain, isConsumerDomain, isDeadDomain, ROLE_PREFIXES } from './domains.js';
import { hasNameMatch } from './names.js';
import type { MillionVerifier } from './millionVerifier.js';

const COLUMN_BONUS = [2, 1, 0] as const;

export type EmailCandidate = {
  email: string;
  columnIndex: number;
};

export type ScoredCandidate = EmailCandidate & {
  score: number;
};

export function normalizeEmail(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'nan') return null;
  if (!trimmed.includes('@')) return null;
  return trimmed;
}

function parseEmailParts(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return {
    local: email.slice(0, at).toLowerCase(),
    domain: email.slice(at + 1).toLowerCase(),
  };
}

function isRoleBased(local: string): boolean {
  return ROLE_PREFIXES.some((prefix) => local === prefix || local.startsWith(`${prefix}.`) || local.startsWith(prefix));
}

export async function scoreEmail(
  email: string,
  personName: string,
  columnIndex: number,
  verifier: MillionVerifier,
): Promise<number> {
  const parts = parseEmailParts(email);
  if (!parts) return 0;

  const { local, domain } = parts;
  if (isDeadDomain(domain)) return 0;

  let score = 0;

  if (isBusinessDomain(domain)) {
    score += 50;
    const valid = await verifier.verify(email);
    if (!valid) score -= 60;
  } else if (isConsumerDomain(domain)) {
    score += 20;
  } else {
    return 0;
  }

  if (isRoleBased(local)) score -= 15;
  if (hasNameMatch(local, personName)) score += 15;
  score += COLUMN_BONUS[columnIndex] ?? 0;

  return score;
}

export async function pickBestEmail(
  personName: string,
  emails: Array<string | null | undefined>,
  verifier: MillionVerifier,
): Promise<string> {
  const candidates: ScoredCandidate[] = [];

  for (let columnIndex = 0; columnIndex < emails.length; columnIndex++) {
    const normalized = normalizeEmail(emails[columnIndex]);
    if (!normalized) continue;

    const score = await scoreEmail(normalized, personName, columnIndex, verifier);
    candidates.push({ email: normalized, columnIndex, score });
  }

  if (candidates.length === 0) return '';

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.columnIndex - b.columnIndex;
  });

  const winner = candidates[0]!;
  return winner.score > 0 ? winner.email : '';
}
