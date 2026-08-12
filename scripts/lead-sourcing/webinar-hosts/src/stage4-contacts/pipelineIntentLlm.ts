import type { CallCounter } from '../lib/callCounter.js';
import { withRetry } from '../lib/retry.js';
import { evaluatePipelineIntent } from './pipelineIntentFilter.js';

export const PIPELINE_KEEP_INTENTS = new Set(['pipeline', 'demand_gen']);

export const PIPELINE_DROP_INTENTS = new Set([
  'customer_training',
  'onboarding',
  'partner_enablement',
  'internal',
  'recruiting',
  'academic',
  'civic',
  'unclear',
]);

export type PipelineIntentLabel =
  | 'pipeline'
  | 'demand_gen'
  | 'customer_training'
  | 'onboarding'
  | 'partner_enablement'
  | 'internal'
  | 'recruiting'
  | 'academic'
  | 'civic'
  | 'unclear';

export type PipelineIntentLlmResult = {
  intent: PipelineIntentLabel;
  confidence: number;
  audience: string;
  reason: string;
  pass: boolean;
  source: 'llm' | 'regex_deny' | 'fixture' | 'empty' | 'error';
};

export type ScorePipelineIntentOptions = {
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
  webinarTopic?: string;
};

const EMPTY: PipelineIntentLlmResult = {
  intent: 'unclear',
  confidence: 0,
  audience: '',
  reason: 'no_post_text',
  pass: false,
  source: 'empty',
};

const SYSTEM_PROMPT = `Classify a LinkedIn webinar/event promotion for B2B outbound targeting.
Reply with JSON only:
{"intent":"pipeline|demand_gen|customer_training|onboarding|partner_enablement|internal|recruiting|academic|civic|unclear","confidence":0.0,"audience":"","reason":""}

Definitions:
- demand_gen / pipeline: OPEN registration aimed at EXTERNAL professionals, buyers, prospects, or industry peers. Product demos, thought leadership webinars, industry trend sessions, and "register now" posts for the public/LinkedIn audience count here even if not explicitly salesy.
- customer_training: clearly limited to existing customers/clients/users ("for our customers", CS academy, client-only).
- onboarding: how-to for people who already bought/use the product (not a public demo for prospects).
- partner_enablement: partners, resellers, certified implementers in a partner program only.
- internal: employees-only, all-hands, staff training.
- recruiting: hiring, career fair, open roles.
- academic / civic: thesis defense, public hearing, voter, census, etc.
- unclear: ONLY when the audience is truly ambiguous after reading the post.

Default: if there is a public register/join CTA and no clear customer/partner/employee restriction, use demand_gen.
Do NOT use unclear when the reason you would write already sounds like demand_gen.`;

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeIntent(raw: unknown): PipelineIntentLabel {
  const intent = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (intent === 'demandgen') return 'demand_gen';
  if (PIPELINE_KEEP_INTENTS.has(intent) || PIPELINE_DROP_INTENTS.has(intent)) {
    return intent as PipelineIntentLabel;
  }
  return 'unclear';
}

export function parsePipelineIntentLlmContent(content: string): Omit<PipelineIntentLlmResult, 'pass' | 'source'> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { intent: 'unclear', confidence: 0, audience: '', reason: 'empty_llm_content' };
  }
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { intent: 'unclear', confidence: 0, audience: '', reason: 'no_json' };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return {
      intent: normalizeIntent(parsed.intent),
      confidence: clampConfidence(parsed.confidence),
      audience: String(parsed.audience ?? '').trim().slice(0, 200),
      reason: String(parsed.reason ?? '').trim().slice(0, 300),
    };
  } catch {
    return { intent: 'unclear', confidence: 0, audience: '', reason: 'json_parse_error' };
  }
}

export function isPipelineIntentPass(intent: PipelineIntentLabel): boolean {
  return PIPELINE_KEEP_INTENTS.has(intent);
}

export async function scorePipelineIntent(
  postText: string,
  options: ScorePipelineIntentOptions = {},
): Promise<PipelineIntentLlmResult> {
  const text = postText.trim();
  if (!text) return { ...EMPTY };

  const regex = evaluatePipelineIntent(text);
  if (!regex.pass) {
    return {
      intent: regex.reason.includes('recruiting')
        ? 'recruiting'
        : regex.reason.includes('civic')
          ? 'civic'
          : regex.reason.includes('academic')
            ? 'academic'
            : 'internal',
      confidence: 0.95,
      audience: '',
      reason: regex.reason,
      pass: false,
      source: 'regex_deny',
    };
  }

  if (options.useFixtures) {
    const lower = text.toLowerCase();
    let intent: PipelineIntentLabel = 'pipeline';
    if (lower.includes('for our customers') || lower.includes('customer training')) {
      intent = 'customer_training';
    } else if (lower.includes('onboarding') && !lower.includes('demo')) {
      intent = 'onboarding';
    } else if (lower.includes('partner enablement') || lower.includes('for partners')) {
      intent = 'partner_enablement';
    } else if (lower.includes('career fair') || lower.includes("we're hiring")) {
      intent = 'recruiting';
    }
    return {
      intent,
      confidence: 0.9,
      audience: intent === 'pipeline' ? 'prospects' : '',
      reason: 'fixture',
      pass: isPipelineIntentPass(intent),
      source: 'fixture',
    };
  }

  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      intent: 'unclear',
      confidence: 0,
      audience: '',
      reason: 'missing_openrouter_api_key',
      pass: false,
      source: 'error',
    };
  }

  options.counter?.increment('openrouter_calls');
  const fetchImpl = options.fetchImpl ?? fetch;
  const topicLine = options.webinarTopic?.trim()
    ? `\nKnown webinar topic: ${options.webinarTopic.trim().slice(0, 200)}`
    : '';

  try {
    const response = await withRetry(async () => {
      const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `${text.slice(0, 4000)}${topicLine}` },
          ],
          temperature: 0,
        }),
      });
      if (!res.ok) {
        const err = new Error(`OpenRouter failed: ${res.status}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      return res.json() as Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
    });

    const content = response.choices?.[0]?.message?.content ?? '';
    const parsed = parsePipelineIntentLlmContent(content);
    return {
      ...parsed,
      pass: isPipelineIntentPass(parsed.intent),
      source: 'llm',
    };
  } catch (error) {
    return {
      intent: 'unclear',
      confidence: 0,
      audience: '',
      reason: error instanceof Error ? error.message.slice(0, 200) : 'llm_error',
      pass: false,
      source: 'error',
    };
  }
}
