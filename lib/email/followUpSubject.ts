import { buildCampaignEmailContent } from './buildCampaignEmailContent.js';
import type { LeadLike } from './mergeTemplate.js';

const NO_SUBJECT_PLACEHOLDER = '(no subject)';

/**
 * True when the node/variant subject means "continue the prior thread"
 * rather than start a new client-side conversation.
 *
 * Empty / whitespace and the mistaken UI placeholder "(No subject)" all count.
 */
export function isThreadContinuingSubject(subject: string | null | undefined): boolean {
  const trimmed = String(subject ?? '').trim();
  if (!trimmed) return true;
  return trimmed.toLowerCase() === NO_SUBJECT_PLACEHOLDER;
}

/**
 * Normalize a subject for storage on campaign email nodes.
 * Never persists the display placeholder "(No subject)".
 */
export function normalizeStoredEmailSubject(subject: string | null | undefined): string {
  const trimmed = String(subject ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === NO_SUBJECT_PLACEHOLDER) return '';
  return trimmed;
}

export type ResolveCampaignFollowUpSubjectParams = {
  currentSubject: string | null | undefined;
  firstSentSubject: string | null | undefined;
  firstSubjectTemplate: string | null | undefined;
  lead: LeadLike;
};

/**
 * Resolve the subject line for a campaign follow-up send.
 *
 * - Non-continuing current subject → send as-is (intentional new thread).
 * - Continuing + known first sent subject → reuse exact string (no re-spin).
 * - Continuing + missing first sent subject → deterministic render of first template.
 */
export function resolveCampaignFollowUpSubject(
  params: ResolveCampaignFollowUpSubjectParams,
): string {
  const current = String(params.currentSubject ?? '');
  if (!isThreadContinuingSubject(current)) {
    return current;
  }

  const firstSent = String(params.firstSentSubject ?? '').trim();
  if (firstSent) {
    return firstSent;
  }

  const template = String(params.firstSubjectTemplate ?? '');
  return buildCampaignEmailContent(
    { subject: template },
    params.lead,
    { deterministic: true },
  ).subject;
}
