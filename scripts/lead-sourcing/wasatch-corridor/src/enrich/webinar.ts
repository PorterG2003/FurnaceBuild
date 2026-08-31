import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CE_PROFESSIONS,
  DEFAULT_OPENROUTER_MODEL,
  REGISTRATION_RE,
  WEBINAR_PAGE_PATHS,
  WEBINAR_PLATFORM_RE,
  WEBINAR_PLATFORMS,
  WEBINAR_PURPOSE_PROMPT_VERSION,
} from '../../config/sources.js';
import { hasForm } from '../lib/html.js';
import { readCached, writeCached } from '../lib/cache.js';
import { fixturesDir } from '../lib/env.js';
import type { CompanyRecord, PipelineContext, WebinarCadence, WebinarPurpose } from '../types.js';
import type { CrawledSite } from './crawl.js';

export type WebinarSignals = {
  runs_webinars: number;
  webinar_platform: string;
  webinar_pages: string[];
  has_registration_page: boolean;
  webinar_purpose: WebinarPurpose;
  webinar_cadence: WebinarCadence;
  webinar_recency: string;
  webinar_audience: string;
  audience_is_ce_profession: boolean;
  ce_profession: string;
  audience_nameable: boolean;
  webinar_role_detected: boolean;
  wants_more_attendance: boolean;
};

const WEBINAR_WORD_RE = /\bwebinars?\b/i;
const WEBINAR_REGISTER_RE =
  /\b(save your seat|save my seat|join us live|reserve your spot|register (?:for|to) (?:the |our |this )?(?:webinar|event))\b/i;

export function hasWebinarBody(text: string): boolean {
  if (!text) return false;
  return WEBINAR_WORD_RE.test(text) || WEBINAR_PLATFORM_RE.test(text) || WEBINAR_REGISTER_RE.test(text);
}

function detectPlatform(text: string): string {
  const match = text.match(WEBINAR_PLATFORM_RE);
  if (!match) return '';
  const raw = match[0].toLowerCase();
  return WEBINAR_PLATFORMS.find((p) => raw.replace(/\s+/g, '').includes(p.toLowerCase().replace(/\s+/g, ''))) ?? match[0];
}

function detectCe(text: string): { yes: boolean; label: string } {
  for (const row of CE_PROFESSIONS) {
    if (row.re.test(text)) return { yes: true, label: row.label };
  }
  return { yes: false, label: '' };
}

function dateMatches(text: string): string[] {
  const dates =
    text.match(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi,
    ) ?? [];
  return dates;
}

function isWebinarPath(path: string): boolean {
  return WEBINAR_PAGE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function heuristicWebinar(
  site: CrawledSite,
  extraText = '',
): Omit<WebinarSignals, 'webinar_purpose'> & { webinar_purpose?: WebinarPurpose } {
  const pages = site.pages.filter((p) => hasWebinarBody(p.text) && (isWebinarPath(p.path) || WEBINAR_WORD_RE.test(p.text)));
  const webinarText = pages.map((p) => p.text).join('\n');
  const platform = detectPlatform(webinarText) || (pages.length ? detectPlatform(pages.map((p) => p.html).join('\n')) : '');
  const registration = pages.some((p) => hasForm(p.html) && (REGISTRATION_RE.test(p.text) || WEBINAR_REGISTER_RE.test(p.text)));
  const dates = dateMatches(webinarText);
  const cadence: WebinarCadence =
    dates.length >= 3 ? 'recurring' : dates.length === 1 ? 'one_off' : dates.length === 2 ? 'occasional' : 'unknown';
  const recency = dates[0] ?? '';
  const mention = pages.some((p) => WEBINAR_WORD_RE.test(p.text));
  const ce = pages.length ? detectCe(webinarText) : { yes: false, label: '' };
  let confidence = 0;
  if (registration) confidence += 0.4;
  if (platform) confidence += 0.25;
  if (pages.length) confidence += 0.2;
  if (mention) confidence += 0.1;
  if (dates.length) confidence += 0.1;
  confidence = Math.min(1, confidence);

  const audienceMatch = webinarText.match(/for\s+(licensed\s+)?([a-z][a-z\s]{3,40}?)(?:\.|,|who)/i);
  const webinar_audience = ce.label || (audienceMatch ? audienceMatch[0].replace(/^for\s+/i, '').trim() : '');
  const audience_nameable =
    Boolean(ce.label) ||
    /\b(therapist|counselor|physician|nurse|dentist|cpa|attorney|engineer|teacher|director|manager)\b/i.test(
      webinar_audience,
    );

  void extraText;
  return {
    runs_webinars: confidence,
    webinar_platform: platform,
    webinar_pages: [...new Set(pages.map((p) => p.path))],
    has_registration_page: registration,
    webinar_cadence: cadence,
    webinar_recency: recency,
    webinar_audience,
    audience_is_ce_profession: ce.yes,
    ce_profession: ce.label,
    audience_nameable,
    webinar_role_detected: /\b(webinar|event)\s+(manager|marketer|coordinator)\b/i.test(webinarText),
    wants_more_attendance: /\b(limited seats|register now|paid ads?|don't miss)\b/i.test(webinarText) || registration,
  };
}

async function classifyPurpose(
  ctx: PipelineContext,
  company: CompanyRecord,
  text: string,
): Promise<WebinarPurpose> {
  const request = { version: WEBINAR_PURPOSE_PROMPT_VERSION, domain: company.domain, snippet: text.slice(0, 1500) };
  if (ctx.fixtures) {
    const path = join(fixturesDir, 'llm', 'webinar-purpose.json');
    let purpose: WebinarPurpose = 'unknown';
    if (existsSync(path)) {
      const map = JSON.parse(readFileSync(path, 'utf8')) as Record<string, WebinarPurpose>;
      purpose = map[company.company_id] ?? map[company.domain ?? ''] ?? map.default ?? 'sales_pipeline';
    }
    writeCached(ctx.cacheRoot, 'openrouter-webinar-purpose', request, { purpose });
    return purpose;
  }
  const cached = readCached<{ purpose: WebinarPurpose }>(ctx.cacheRoot, 'openrouter-webinar-purpose', request);
  if (cached) return cached.body.purpose;

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return 'unknown';
  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Classify webinar purpose from titles and registration copy. JSON: {"purpose":"sales_pipeline"|"brand_awareness"|"customer_training"|"internal_training"}. Customer/internal training is NOT sales_pipeline.',
        },
        { role: 'user', content: text.slice(0, 6000) },
      ],
    }),
  });
  if (!response.ok) return 'unknown';
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { purpose?: WebinarPurpose };
  const purpose = parsed.purpose ?? 'unknown';
  writeCached(ctx.cacheRoot, 'openrouter-webinar-purpose', request, { purpose });
  return purpose;
}

export async function extractWebinarSignals(
  ctx: PipelineContext,
  company: CompanyRecord,
  site: CrawledSite,
): Promise<WebinarSignals> {
  const heur = heuristicWebinar(site);
  let purpose: WebinarPurpose = 'unknown';
  if (heur.runs_webinars >= 0.3) {
    const snippet = heur.webinar_pages.length
      ? site.pages.filter((p) => heur.webinar_pages.includes(p.path)).map((p) => p.text).join('\n')
      : site.pages.map((p) => p.text).join('\n');
    purpose = await classifyPurpose(ctx, company, snippet);
  }
  return { ...heur, webinar_purpose: purpose };
}

export function applyWebinar(company: CompanyRecord, signals: WebinarSignals): void {
  Object.assign(company, {
    runs_webinars: signals.runs_webinars,
    webinar_platform: signals.webinar_platform,
    webinar_pages: signals.webinar_pages,
    has_registration_page: signals.has_registration_page,
    webinar_purpose: signals.webinar_purpose,
    webinar_cadence: signals.webinar_cadence,
    webinar_recency: signals.webinar_recency,
    webinar_audience: signals.webinar_audience,
    audience_is_ce_profession: signals.audience_is_ce_profession,
    ce_profession: signals.ce_profession,
    audience_nameable: signals.audience_nameable,
    webinar_role_detected: company.webinar_role_detected || signals.webinar_role_detected,
    wants_more_attendance: signals.wants_more_attendance,
  });
  company.provenance.runs_webinars = { source: 'crawl', cached_at: new Date().toISOString() };
}
