import { buildCampaignEmailContent } from '../buildCampaignEmailContent.js';
import type { LeadLike } from '../mergeTemplate.js';

/** UI-only placeholder. Never a stored value and never an SMTP subject. */
export const NO_SUBJECT_DISPLAY = '(No subject)';

const NO_SUBJECT_RE = /^\(\s*no\s+subject\s*\)$/i;

/** True when a subject is the display placeholder rather than real content. */
export function isNoSubjectPlaceholder(value: string | null | undefined): boolean {
  return NO_SUBJECT_RE.test(String(value ?? '').trim());
}

/**
 * True when a subject still contains unrendered merge or spintax syntax.
 *
 * Detects mustache variables (`{{first_name}}`) and spintax alternation, where
 * the pipe may sit at any brace depth — `{Hello {{name}}|Hi {{name}}}` nests a
 * mustache inside a spintax group, which naive flat patterns miss.
 */
export function containsUnresolvedTemplate(value: string | null | undefined): boolean {
  const subject = String(value ?? '');
  if (!subject) return false;
  if (/\{\{[^{}]*\}\}/.test(subject)) return true;

  let depth = 0;
  for (const char of subject) {
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === '|' && depth > 0) return true;
  }
  return false;
}

/** True when a subject is safe to store or display as-is. */
function isCleanSubject(value: string | null | undefined): boolean {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return false;
  if (isNoSubjectPlaceholder(trimmed)) return false;
  return !containsUnresolvedTemplate(trimmed);
}

export type ResolveDeliveredSubjectInput = {
  /** events.event_data.sent_subject — the most authoritative record. */
  eventSentSubject?: string | null;
  /** message_jobs.message_data.sent_subject. */
  messageDataSentSubject?: string | null;
  /** message_jobs.message_data.subject. */
  messageDataSubject?: string | null;
  /** Raw node_config.subject. Only ever used as a render source, never verbatim. */
  nodeConfigSubject?: string | null;
  /** Required to render the template fallback. */
  lead?: LeadLike | null;
};

/**
 * The subject a message actually carried, for storage and display.
 *
 * Prefers recorded delivered values, and when only a raw template survives it
 * renders deterministically rather than leaking spintax. An empty result is a
 * legitimate answer: campaigns may send an intentionally empty subject, and
 * callers show the placeholder rather than storing one.
 */
export function resolveDeliveredSubject(input: ResolveDeliveredSubjectInput): string {
  const recorded = [
    input.eventSentSubject,
    input.messageDataSentSubject,
    input.messageDataSubject,
  ];
  for (const candidate of recorded) {
    if (isCleanSubject(candidate)) return String(candidate).trim();
  }

  const template = String(input.nodeConfigSubject ?? '').trim();
  if (!template || isNoSubjectPlaceholder(template)) return '';
  if (!containsUnresolvedTemplate(template)) return template;

  const rendered = buildCampaignEmailContent({ subject: template }, input.lead ?? {}, {
    deterministic: true,
  }).subject.trim();

  // Missing merge values render as empty, which can leave stray spacing.
  if (!containsUnresolvedTemplate(rendered)) return rendered;
  return salvageMalformedTemplate(rendered);
}

/**
 * Last resort for templates the renderer cannot close, such as a subject stored
 * truncated mid-spintax (`{Web traffic|Web visits`). Keeps the first alternative
 * and strips template syntax so readable text survives instead of blanking the
 * subject. Returns empty if nothing safe remains.
 */
function salvageMalformedTemplate(value: string): string {
  const salvaged = value
    .replace(/\{\{[^{}]*\}\}/g, '')
    .split('|')[0]!
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return containsUnresolvedTemplate(salvaged) ? '' : salvaged;
}

export type ComposerSubjectInput = {
  /** Subject of the specific message being replied to or forwarded. */
  parentMessageSubject?: string | null;
  /** email_threads.subject, used only when the parent has nothing usable. */
  threadSubject?: string | null;
  lead?: LeadLike | null;
};

/**
 * Default subject for a composer reply, preferring the parent message's own
 * subject over the thread title, which is frozen at thread creation and may be
 * stale or raw. Returns empty when nothing usable exists.
 */
export function buildReplyDefaultSubject(input: ComposerSubjectInput): string {
  const base = resolveComposerBaseSubject(input);
  if (!base) return '';
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`;
}

/** Default subject for a composer forward. See buildReplyDefaultSubject. */
export function buildForwardDefaultSubject(input: ComposerSubjectInput): string {
  const base = resolveComposerBaseSubject(input);
  if (!base) return '';
  return /^fwd?\s*:/i.test(base) ? base : `Fwd: ${base}`;
}

function resolveComposerBaseSubject(input: ComposerSubjectInput): string {
  for (const candidate of [input.parentMessageSubject, input.threadSubject]) {
    if (isCleanSubject(candidate)) return String(candidate).trim();
  }

  const salvageable = [input.parentMessageSubject, input.threadSubject].find((value) =>
    containsUnresolvedTemplate(value),
  );
  if (salvageable) {
    return resolveDeliveredSubject({ nodeConfigSubject: String(salvageable), lead: input.lead });
  }
  return '';
}
