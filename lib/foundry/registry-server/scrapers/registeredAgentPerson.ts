import { normalizePersonName } from './normalizeNames.js';

const LAWYER_NAME_RE =
  /\b(P\.?\s*A\.?|L\.L\.P\.|LLP|ATTORNEYS?\b|ATTORNEY\b|AT\s+LAW|LAW\s+(OFFICES?|FIRM|GROUP)|\bESQ\b)/i;
const STATUTORY_AGENT_RE =
  /\b(CORPORATION\s+SERVICE|CSC-?|CT\s+CORPORATION|REGISTERED\s+AGENTS?\b|INCORP\s+SERVICES|LEGALINC|ZOOM|NW\s+REGISTERED|UNITED\s+AGENT|URS\s+AGENTS?|PRESTIGE\s+LEGAL)\b/i;

function isLawyerLikeRegisteredAgentName(name: string): boolean {
  if (/\b(attorney|counsel)\b/i.test(name)) return true;
  return LAWYER_NAME_RE.test(name);
}

function isCorporateStatutoryAgentName(name: string): boolean {
  const u = name.toUpperCase();
  if (STATUTORY_AGENT_RE.test(u)) return true;
  if (/\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION)\b/.test(u)) return true;
  return false;
}

function looksLikeNaturalPersonName(name: string): boolean {
  const t = name.trim();
  if (t.length < 3) return false;
  if (/,\s*[A-Za-z]/.test(t)) return true;
  const parts = normalizePersonName(t).split(' ').filter((x) => x.length > 1);
  return parts.length >= 2;
}

/**
 * Whether a registered-agent **name string** may be stored as an `entity_owner` fallback row.
 * Rejects obvious companies, statutory shops, and law-firm style names.
 */
export function eligibleIndividualRegisteredAgentName(rawName: string | undefined | null): boolean {
  const name = rawName?.trim();
  if (!name) return false;
  if (isCorporateStatutoryAgentName(name)) return false;
  if (isLawyerLikeRegisteredAgentName(name)) return false;
  return looksLikeNaturalPersonName(name);
}
