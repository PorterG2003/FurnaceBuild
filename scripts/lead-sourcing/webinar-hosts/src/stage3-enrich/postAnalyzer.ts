import type { CallCounter } from '../lib/callCounter.js';
import { withRetry } from '../lib/retry.js';

export type PostAnalysis = {
  webinar_topic: string;
  webinar_date_mention: string;
  target_audience: string;
};

export type PostAnalyzerOptions = {
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
  enabled?: boolean;
};

const EMPTY: PostAnalysis = {
  webinar_topic: '',
  webinar_date_mention: '',
  target_audience: '',
};

export function parsePostAnalysisFromContent(content: string): PostAnalysis {
  const trimmed = content.trim();
  if (!trimmed) return EMPTY;

  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<PostAnalysis>;
      return {
        webinar_topic: parsed.webinar_topic ?? '',
        webinar_date_mention: parsed.webinar_date_mention ?? '',
        target_audience: parsed.target_audience ?? '',
      };
    }
  } catch {
    // fall through
  }

  return EMPTY;
}

export async function analyzePostText(
  postText: string,
  options: PostAnalyzerOptions = {},
): Promise<PostAnalysis> {
  if (!postText.trim()) return EMPTY;
  if (options.enabled === false) return EMPTY;

  if (options.useFixtures) {
    if (postText.toLowerCase().includes('demand gen')) {
      return {
        webinar_topic: 'Demand generation webinar',
        webinar_date_mention: 'March 15',
        target_audience: 'B2B marketers',
      };
    }
    return {
      webinar_topic: 'Product marketing webinar',
      webinar_date_mention: '',
      target_audience: 'Marketing leaders',
    };
  }

  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return EMPTY;

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
          {
            role: 'system',
            content:
              'Extract webinar metadata from LinkedIn post text. Reply with JSON only: {"webinar_topic":"","webinar_date_mention":"","target_audience":""}',
          },
          { role: 'user', content: postText.slice(0, 4000) },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter failed: ${res.status}`);
    return res.json() as Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
  });

  const content = response.choices?.[0]?.message?.content ?? '';
  return parsePostAnalysisFromContent(content);
}
