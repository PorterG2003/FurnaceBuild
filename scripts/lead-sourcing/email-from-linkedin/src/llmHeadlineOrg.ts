import type { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { withRetry } from '../../webinar-hosts/src/lib/retry.js';
import { looksLikeSchoolOrg, type HeadlineHints } from './nameParse.js';

export type LlmHeadlineOrgOptions = {
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
  enabled?: boolean;
  model?: string;
};

const EMPTY: HeadlineHints = { title: '', organizationName: '' };

/** Regex orgs that are usually wrong (e.g. "of" capturing mid-title). */
export function isWeakOrganizationHint(org: string): boolean {
  const trimmed = org.trim();
  if (!trimmed) return true;
  if (/^(and|of|the|at|for|to)\b/i.test(trimmed)) return true;
  if (/@\w/.test(trimmed)) return true;
  if (trimmed.length > 90) return true;
  if (!looksLikeSchoolOrg(trimmed) && !/\b(school|district|academy|isd|usd)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

const SYSTEM_PROMPT = `Extract the person's job title and current school or school-district employer from a LinkedIn headline.
Reply with JSON only: {"title":"","organizationName":""}
Rules:
- organizationName must be a school, school district, academy, ISD, USD, or similar K-12 employer name when present.
- Prefer the employer they currently work for (not associations like NAESP, TEDx, consulting brands, or alumni schools).
- If no school/district employer is mentioned, return organizationName as "".
- Do not invent organizations. Truncate marketing slogans.`;

export function parseHeadlineOrgFromLlmContent(content: string): HeadlineHints {
  const trimmed = content.trim();
  if (!trimmed) return EMPTY;

  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return EMPTY;
    const parsed = JSON.parse(jsonMatch[0]) as {
      title?: unknown;
      organizationName?: unknown;
      organization_name?: unknown;
    };
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const organizationName = (
      typeof parsed.organizationName === 'string'
        ? parsed.organizationName
        : typeof parsed.organization_name === 'string'
          ? parsed.organization_name
          : ''
    ).trim();

    if (organizationName && !looksLikeSchoolOrg(organizationName)) {
      // Allow LLM orgs that mention district/school-ish words even if regex is strict
      if (!/\b(school|district|academy|isd|usd|elementary|high|middle|charter|college|university)\b/i.test(organizationName)) {
        return { title: title.slice(0, 120), organizationName: '' };
      }
    }

    return {
      title: title.slice(0, 120),
      organizationName: organizationName.slice(0, 120),
    };
  } catch {
    return EMPTY;
  }
}

function fixtureHints(headline: string): HeadlineHints {
  const lower = headline.toLowerCase();
  if (lower.includes('clearview local')) {
    return {
      title: 'Director of Curriculum and Instruction',
      organizationName: 'Clearview Local Schools',
    };
  }
  if (lower.includes('rolling meadows')) {
    return { title: 'Dean of Students', organizationName: 'Rolling Meadows High School' };
  }
  if (lower.includes('goshen')) {
    return { title: 'Principal', organizationName: 'Goshen High School' };
  }
  if (lower.includes('3-5 principal') || lower === 'principal') {
    return { title: 'Principal', organizationName: '' };
  }
  return EMPTY;
}

/**
 * Use OpenRouter to extract school/district employer from a hard LinkedIn headline.
 * Fixture mode returns canned orgs for known test headlines.
 */
export async function extractHeadlineOrgWithLlm(
  headline: string,
  options: LlmHeadlineOrgOptions = {},
): Promise<HeadlineHints> {
  const trimmed = headline.trim();
  if (!trimmed) return EMPTY;
  if (options.enabled === false) return EMPTY;

  if (options.useFixtures) {
    options.counter?.increment('openrouter_calls');
    return fixtureHints(trimmed);
  }

  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return EMPTY;

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? 'google/gemini-2.5-flash-lite';

  const response = await withRetry(async () => {
    const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: trimmed.slice(0, 500) },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenRouter failed: ${res.status} ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
  });

  options.counter?.increment('openrouter_calls');
  const content = response.choices?.[0]?.message?.content ?? '';
  return parseHeadlineOrgFromLlmContent(content);
}
