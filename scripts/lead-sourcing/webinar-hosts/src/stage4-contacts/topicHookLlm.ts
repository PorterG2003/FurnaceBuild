import type { CallCounter } from '../lib/callCounter.js';
import { withRetry } from '../lib/retry.js';

export const TOPIC_HOOK_FALLBACK = 'your next webinar';

const SYSTEM_PROMPT = `Turn a webinar/event title into a short personalization hook for cold email.
Reply with JSON only: {"topic_hook":"..."}

The hook is inserted into frames like:
- "…pack rooms around topics like {hook}"
- "Packing rooms around {hook}?"

Rules:
- 2 to 7 words, lowercase except proper nouns/acronyms
- Subject matter only: what the event is ABOUT (the theme), not the promo title
- Strip format/event words: masterclass, workshop, summit, bootcamp, roundtable, series, session(s), webinar(s), event, conference, panel
- No full sentences, no quotes, no trailing punctuation
- Prefer "Microsoft Copilot" over "Microsoft Copilot Masterclass"
- Prefer "GRID trading" over "GRID Trading Masterclass: …"
- NEVER include webinar/webinars (the email already says webinar)
- Do NOT end with: insights, strategies, strategy, secrets, tips, solutions
- Do NOT start with a gerund like becoming/finding/writing/building/getting
- If the title is empty or useless, use "your next webinar"

Good examples:
- title "Navigating estate planning and Medicaid" → {"topic_hook":"estate and Medicaid planning"}
- title "AI Invoice Management Workshop" → {"topic_hook":"AI invoice management"}
- title "Microsoft Fabric Masterclass" → {"topic_hook":"Microsoft Fabric"}
- title "Claude Code Masterclass for Engineering Workflows" → {"topic_hook":"Claude Code"}
- title "Private Credit in India" → {"topic_hook":"private credit India"}
- title "Job Hunt Masterclass" → {"topic_hook":"job hunting"}

Bad examples (do not produce these):
- "Microsoft Copilot Masterclass" (format word)
- "enablement webinars" (webinar word)
- "AI governance insights" (meta ending)
- "becoming an EOS Implementer" (leading gerund)`;

const RETRY_USER_PREFIX =
  'Previous hook was invalid for email merge. Reply again with JSON only. Subject matter only — no masterclass/workshop/summit/webinar(s), no insights/strategies/secrets/tips/solutions, no leading gerunds.\n\nTitle: ';

const BANNED_ENDINGS = new Set([
  'insights',
  'insight',
  'strategies',
  'strategy',
  'secrets',
  'secret',
  'tips',
  'tip',
  'solutions',
  'solution',
]);

/** Event/format words that make "topics like X" sound like a title paste. */
const BANNED_FORMAT_WORDS = new Set([
  'masterclass',
  'masterclasses',
  'workshop',
  'workshops',
  'summit',
  'summits',
  'bootcamp',
  'bootcamps',
  'roundtable',
  'roundtables',
  'series',
  'session',
  'sessions',
  'webinar',
  'webinars',
  'event',
  'events',
  'conference',
  'conferences',
  'panel',
  'panels',
  'seminar',
  'seminars',
  'meetup',
  'meetups',
]);

const LEADING_GERUNDS = new Set([
  'becoming',
  'finding',
  'writing',
  'building',
  'creating',
  'getting',
  'making',
  'using',
  'learning',
  'developing',
  'achieving',
  'coping',
  'navigating',
]);

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isValidTopicHook(hook: string): boolean {
  const h = hook.trim();
  if (!h) return false;
  if (h === TOPIC_HOOK_FALLBACK) return true;
  if (/[{}]/.test(h) || /topic_hook/i.test(h)) return false;
  if ((h.match(/"/g) || []).length % 2 !== 0) return false;
  if ((h.match(/'/g) || []).length % 2 !== 0) return false;
  const words = h.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 7) return false;
  for (const word of words) {
    const norm = normalizeWord(word);
    if (BANNED_FORMAT_WORDS.has(norm)) return false;
  }
  const first = normalizeWord(words[0]!);
  if (LEADING_GERUNDS.has(first)) return false;
  const last = normalizeWord(words[words.length - 1]!);
  if (BANNED_ENDINGS.has(last)) return false;
  return true;
}

export function sanitizeHook(raw: string): string {
  let h = raw.replace(/^topic_hook\s*[:=]\s*/i, '').trim();
  h = h.replace(/^["']|["']$/g, '').trim();
  h = h.replace(/[.""']+$/g, '').trim();
  // Drop accidental JSON wrappers that survived parse failure
  if (/^\{\s*"?topic_hook/i.test(h) || h.startsWith('{')) {
    return TOPIC_HOOK_FALLBACK;
  }
  const words = h.split(/\s+/).filter(Boolean);
  if (words.length === 0) return TOPIC_HOOK_FALLBACK;
  if (words.length > 7) h = words.slice(0, 7).join(' ');
  return h || TOPIC_HOOK_FALLBACK;
}

export function parseTopicHookContent(content: string): string {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { topic_hook?: unknown };
      const hook = String(parsed.topic_hook ?? '').trim();
      if (hook) return sanitizeHook(hook);
    } catch {
      // fall through
    }
  }
  return sanitizeHook(trimmed.replace(/^["']|["']$/g, ''));
}

export type TopicHookOptions = {
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
};

async function callOpenRouter(
  userContent: string,
  options: TopicHookOptions,
): Promise<string> {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return TOPIC_HOOK_FALLBACK;

  options.counter?.increment('openrouter_calls');
  const fetchImpl = options.fetchImpl ?? fetch;

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
          { role: 'user', content: userContent },
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
  return parseTopicHookContent(content);
}

export async function generateTopicHook(
  webinarTopic: string,
  options: TopicHookOptions = {},
): Promise<string> {
  const topic = webinarTopic.trim();
  if (!topic) return TOPIC_HOOK_FALLBACK;

  if (options.useFixtures) {
    const words = topic
      .split(/\s+/)
      .filter((w) => !BANNED_FORMAT_WORDS.has(normalizeWord(w)))
      .slice(0, 5);
    const base = words.join(' ').toLowerCase() || TOPIC_HOOK_FALLBACK;
    const hook = sanitizeHook(base);
    return isValidTopicHook(hook) ? hook : TOPIC_HOOK_FALLBACK;
  }

  try {
    const first = await callOpenRouter(topic.slice(0, 400), options);
    if (isValidTopicHook(first)) return first;

    const second = await callOpenRouter(`${RETRY_USER_PREFIX}${topic.slice(0, 350)}`, options);
    if (isValidTopicHook(second)) return second;
    return TOPIC_HOOK_FALLBACK;
  } catch {
    return TOPIC_HOOK_FALLBACK;
  }
}
