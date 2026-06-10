/**
 * Categorizer reply classification (scheduler worker).
 *
 * Mirrors the canonical contract in lib/categorizer/index.ts (workers do not
 * import lib/ — keep categories, prompt, and parsing in sync with that file).
 *
 * The LLM transport is injectable so integration tests can run a fake
 * classifier (scripted responses, timeouts, garbage JSON) with zero network
 * calls.
 */

export const CATEGORIZER_BRANCH_CATEGORIES = ['Interested', 'Neutral', 'Not Interested'] as const;
export const AUTO_REPLY_CATEGORY = 'Auto Reply' as const;
export const CATEGORIZER_CATEGORIES = [...CATEGORIZER_BRANCH_CATEGORIES, AUTO_REPLY_CATEGORY] as const;

export type CategorizerBranchCategory = (typeof CATEGORIZER_BRANCH_CATEGORIES)[number];
export type CategorizerCategory = (typeof CATEGORIZER_CATEGORIES)[number];

export const DEFAULT_CATEGORIZER_MODEL = 'google/gemini-2.5-flash-lite';
export const CATEGORIZER_BODY_TRUNCATION_LIMIT = 4000;
export const RETURN_DATE_MAX_DAYS = 90;

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LLM_TIMEOUT_MS = 30_000;

export interface CategorizerClassification {
  category: CategorizerCategory;
  /** ISO date (YYYY-MM-DD) the sender stated they will be back, or null. */
  returnDate: string | null;
}

export interface ClassifyReplyInput {
  subject: string | null;
  bodyText: string | null;
  /** Date the reply was received; anchors relative phrases like "back next Monday". */
  messageDate: Date;
}

export type CategorizerTransportResult =
  | { ok: true; text: string }
  | { ok: false; details: string; httpStatus?: number };

export type CategorizerLlmTransport = (params: {
  model: string;
  system: string;
  user: string;
}) => Promise<CategorizerTransportResult>;

export type ClassifyReplyResult =
  | { ok: true; classification: CategorizerClassification }
  | { ok: false; error: string };

export function isBranchCategory(category: string | null | undefined): category is CategorizerBranchCategory {
  return (
    typeof category === 'string' &&
    (CATEGORIZER_BRANCH_CATEGORIES as readonly string[]).includes(category)
  );
}

export function truncateReplyBody(bodyText: string | null): string {
  const text = (bodyText ?? '').trim();
  if (text.length <= CATEGORIZER_BODY_TRUNCATION_LIMIT) return text;
  return `${text.slice(0, CATEGORIZER_BODY_TRUNCATION_LIMIT)}\n[truncated]`;
}

export function buildCategorizerPrompt(input: ClassifyReplyInput): { system: string; user: string } {
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

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());

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

  const endOfDay = parsed.getTime() + 24 * 60 * 60 * 1000;
  if (endOfDay <= now.getTime()) return null;

  const horizon = now.getTime() + RETURN_DATE_MAX_DAYS * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > horizon) return null;

  return match[0];
}

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

export function resolveCategorizerModel(): string {
  return process.env.OPENROUTER_CATEGORIZER_MODEL?.trim() || DEFAULT_CATEGORIZER_MODEL;
}

/**
 * Default production transport: OpenRouter chat completion, temperature 0,
 * JSON object response format.
 */
export const openRouterCategorizerTransport: CategorizerLlmTransport = async ({
  model,
  system,
  user,
}) => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, details: 'OPENROUTER_API_KEY is not configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 256,
        response_format: { type: 'json_object' },
      }),
      // Cast: ambient node-fetch v2 types conflict with the runtime DOM AbortSignal.
      signal: controller.signal as any,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, details: msg };
  } finally {
    clearTimeout(timeout);
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const errField = body.error as { message?: string } | string | undefined;
    const details =
      (typeof errField === 'string' ? errField : errField?.message) || `HTTP ${res.status}`;
    return { ok: false, details, httpStatus: res.status };
  }

  const choices = body.choices as Array<{ message?: { content?: string | null } }> | undefined;
  const text = choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, details: 'OpenRouter response missing completion text', httpStatus: res.status };
  }

  return { ok: true, text };
};

/**
 * Classify the latest inbound reply into the four categorizer classes, with
 * best-effort return-date extraction for Auto Reply.
 */
export async function classifyReply(
  input: ClassifyReplyInput,
  options?: {
    model?: string;
    transport?: CategorizerLlmTransport;
    now?: Date;
  },
): Promise<ClassifyReplyResult> {
  const model = options?.model ?? resolveCategorizerModel();
  const transport = options?.transport ?? openRouterCategorizerTransport;
  const prompt = buildCategorizerPrompt(input);

  let result: CategorizerTransportResult;
  try {
    result = await transport({ model, system: prompt.system, user: prompt.user });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `LLM transport threw: ${msg}` };
  }

  if (!result.ok) {
    return {
      ok: false,
      error: `LLM call failed${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}: ${result.details}`,
    };
  }

  const classification = parseCategorizerResponse(result.text, options?.now);
  if (!classification) {
    return {
      ok: false,
      error: `Unparseable classification response: ${result.text.slice(0, 200)}`,
    };
  }

  return { ok: true, classification };
}
