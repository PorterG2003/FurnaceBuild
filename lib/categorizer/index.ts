/**
 * Canonical categorizer classification contract: categories, prompt, and
 * response parsing shared by the preview endpoint (Amplify) and mirrored by
 * the scheduler worker (workers/scheduler-worker/src/categorizer/classify.ts
 * — workers do not import lib/, keep both in sync).
 *
 * Spec: docs/implementation/flow/CATEGORIZER_IMPLEMENTATION.md
 */

import { THREAD_CATEGORY_COLORS } from '../inbox/category-colors';

export const CATEGORIZER_BRANCH_CATEGORIES = ['Interested', 'Neutral', 'Not Interested'] as const;
export const AUTO_REPLY_CATEGORY = 'Auto Reply' as const;
export const CATEGORIZER_CATEGORIES = [...CATEGORIZER_BRANCH_CATEGORIES, AUTO_REPLY_CATEGORY] as const;

export type CategorizerBranchCategory = (typeof CATEGORIZER_BRANCH_CATEGORIES)[number];
export type CategorizerCategory = (typeof CATEGORIZER_CATEGORIES)[number];

/** React Flow source handle ids on the categorizer node (scheduler parity). */
export const CATEGORIZER_SOURCE_HANDLES: Record<CategorizerBranchCategory, string> = {
  Interested: 'interested',
  Neutral: 'neutral',
  'Not Interested': 'not-interested',
};

export type CategorizerSourceHandleId =
  (typeof CATEGORIZER_SOURCE_HANDLES)[CategorizerBranchCategory];

const SOURCE_HANDLE_TO_CATEGORY: Record<CategorizerSourceHandleId, CategorizerBranchCategory> = {
  interested: 'Interested',
  neutral: 'Neutral',
  'not-interested': 'Not Interested',
};

/** Longest ids first so "not-interested" is not mistaken for "interested". */
export const CATEGORIZER_SOURCE_HANDLE_IDS: readonly CategorizerSourceHandleId[] = [
  'not-interested',
  'neutral',
  'interested',
];

export function inferCategorizerSourceHandleFromEdgeId(
  edgeId: string,
  sourceNodeId: string,
): CategorizerSourceHandleId | null {
  for (const handle of CATEGORIZER_SOURCE_HANDLE_IDS) {
    if (edgeId.includes(`${sourceNodeId}${handle}`)) {
      return handle;
    }
  }
  return null;
}

export function resolveCategorizerSourceHandle(
  sourceHandle: string | null | undefined,
  edgeId: string,
  sourceNodeId: string | undefined,
): CategorizerSourceHandleId | null {
  if (sourceHandle && sourceHandle in SOURCE_HANDLE_TO_CATEGORY) {
    return sourceHandle as CategorizerSourceHandleId;
  }
  if (!sourceNodeId) return null;
  return inferCategorizerSourceHandleFromEdgeId(edgeId, sourceNodeId);
}

export function getCategorizerSourceHandleColor(
  sourceHandle: string | null | undefined,
): string | null {
  if (!sourceHandle || !(sourceHandle in SOURCE_HANDLE_TO_CATEGORY)) return null;
  const category = SOURCE_HANDLE_TO_CATEGORY[sourceHandle as CategorizerSourceHandleId];
  return THREAD_CATEGORY_COLORS[category] ?? null;
}

export function backfillCategorizerEdgeHandles<
  T extends { id: string; source: string; sourceHandle?: string | null },
>(edges: T[], nodes: Array<{ id: string; type?: string }>): T[] {
  const categorizerNodeIds = new Set(
    nodes.filter((node) => node.type === 'aiCategorizer').map((node) => node.id),
  );

  return edges.map((edge) => {
    if (edge.sourceHandle || !categorizerNodeIds.has(edge.source)) return edge;
    const inferred = inferCategorizerSourceHandleFromEdgeId(edge.id, edge.source);
    return inferred ? { ...edge, sourceHandle: inferred } : edge;
  });
}

export const DEFAULT_CATEGORIZER_MODEL = 'google/gemini-2.5-flash-lite';

/** Max characters of reply body sent to the model. */
export const CATEGORIZER_BODY_TRUNCATION_LIMIT = 4000;

/** Extracted return dates must be in the future and within this horizon. */
export const RETURN_DATE_MAX_DAYS = 90;

export interface CategorizerClassification {
  category: CategorizerCategory;
  /** ISO date (YYYY-MM-DD) the sender stated they will be back, or null. */
  returnDate: string | null;
}

export interface CategorizerPromptInput {
  subject: string | null;
  bodyText: string | null;
  /** Date the reply was received; anchors relative phrases like "back next Monday". */
  messageDate: Date;
}

export function truncateReplyBody(bodyText: string | null): string {
  const text = (bodyText ?? '').trim();
  if (text.length <= CATEGORIZER_BODY_TRUNCATION_LIMIT) return text;
  return `${text.slice(0, CATEGORIZER_BODY_TRUNCATION_LIMIT)}\n[truncated]`;
}

export function buildCategorizerPrompt(input: CategorizerPromptInput): {
  system: string;
  user: string;
} {
  const messageDateIso = input.messageDate.toISOString().slice(0, 10);

  const system = [
    'You classify email replies to cold outreach campaigns.',
    '',
    'Classify the reply into exactly one of these categories:',
    '- "Interested": the sender shows interest, asks questions, wants a call/demo/pricing, or asks to learn more.',
    '- "Neutral": ambiguous, non-committal, asks to reach out later, refers to a colleague, or cannot be judged.',
    '- "Not Interested": the sender declines, asks to stop contacting, or is clearly negative.',
    '- "Auto Reply": automated responses - out-of-office, vacation, parental leave, autoresponders, "I am away" messages, ticket confirmations, or any machine-generated reply.',
    '',
    'If (and only if) the category is "Auto Reply" and the message explicitly states a return date',
    `(e.g. "back on March 3rd", "returning next Monday"), resolve it to an ISO date using the message date ${messageDateIso} for relative phrases.`,
    'If no explicit return date is stated, use null. Never guess.',
    '',
    'Respond with ONLY a JSON object, no prose:',
    '{"category": "Interested" | "Neutral" | "Not Interested" | "Auto Reply", "return_date": "YYYY-MM-DD" | null}',
  ].join('\n');

  const user = [
    `Reply received on: ${messageDateIso}`,
    `Subject: ${(input.subject ?? '').trim() || '(no subject)'}`,
    '',
    'Body:',
    truncateReplyBody(input.bodyText) || '(empty body)',
  ].join('\n');

  return { system, user };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];

  // Strip markdown fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());

  // Fall back to the first {...} span.
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    candidates.push(trimmed.slice(braceStart, braceEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Sanity-bound a model-provided return date: must parse, be in the future,
 * and fall within RETURN_DATE_MAX_DAYS of now. Anything else -> null
 * (resume immediately).
 */
export function sanitizeReturnDate(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(`${match[0]}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  // End of that day must be in the future (a return date of "today" is fine).
  const endOfDay = parsed.getTime() + 24 * 60 * 60 * 1000;
  if (endOfDay <= now.getTime()) return null;

  const horizon = now.getTime() + RETURN_DATE_MAX_DAYS * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > horizon) return null;

  return match[0];
}

/**
 * Parse and validate a raw model response. Returns null when the response is
 * unusable (malformed JSON or out-of-vocabulary category) - callers treat
 * that as a classification failure.
 */
export function parseCategorizerResponse(
  raw: string,
  now: Date = new Date(),
): CategorizerClassification | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  const category = typeof parsed.category === 'string' ? parsed.category.trim() : '';
  if (!(CATEGORIZER_CATEGORIES as readonly string[]).includes(category)) {
    return null;
  }

  const returnDate =
    category === AUTO_REPLY_CATEGORY ? sanitizeReturnDate(parsed.return_date, now) : null;

  return {
    category: category as CategorizerCategory,
    returnDate,
  };
}
