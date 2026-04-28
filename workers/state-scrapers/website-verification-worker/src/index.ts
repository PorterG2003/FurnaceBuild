import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import { chromium, type Browser, type Page } from 'playwright';
import {
  WEBSITE_VERIFIER_VERSION,
  buildCsvBuilderWebsiteVerificationBundle,
  buildCsvBuilderWebsiteVerificationErrorResult,
  buildCsvBuilderWebsiteVerificationRowResult,
  buildCsvBuilderWebsiteVerificationToolJobProgressSnapshot,
  buildWebsiteVerificationProgressSnapshot,
  canonicalizeWebsiteUrl,
  extractCsvBuilderToolOutputValue,
  loadCsvBuilderWebsiteVerificationToolJobProgressCounts,
  loadWebsiteVerificationBundles,
  loadWebsiteVerificationProgressCounts,
  normalizeComparableText,
  normalizeWebsiteInputUrl,
  pickWebsiteVerificationTarget,
  registrableDomainKeyFromUrl,
  pickCsvBuilderWebsiteInputUrl,
  computeCostAmountMicros,
  insertDirectCostRecord,
  resolveRunCost,
  scoreWebsiteVerification,
  WEBSITE_INTELLIGENCE_DEFAULT_MODEL,
  WEBSITE_INTELLIGENCE_MODEL_PROVIDER,
  buildWebsiteIntelligenceValidationReport,
  buildWebsiteSiteBrief,
  hashWebsiteIntelligenceInput,
  normalizeWebsiteExtractedProfile,
  upsertCompanyWebsiteCrawl,
  upsertCompanyWebsiteIntelligence,
  type WebsiteCrawlPage,
  type WebsiteExtractedProfile,
  type WebsiteIntelligenceCrawlResult,
  type WebsiteIntelligenceValidationReport,
  type WebsiteSiteAssets,
  type WebsiteSiteBrief,
  type WebsiteVerificationBundle,
  type WebsiteVerificationCrawlResult,
  type WebsiteVerificationExtractedPage,
  type WebsiteVerificationPageKind,
  type WebsiteVerificationScoredResult,
} from '@furnace/registry-server';

type JobProgress = Record<string, unknown> & {
  in_scope_total?: number;
  companies_processed?: number;
  outcome_usable?: number;
  outcome_uncertain?: number;
  outcome_not_usable?: number;
  outcome_error?: number;
  outcome_skipped?: number;
  companies_with_result?: number;
  current_step?: string;
};

type RawExtractedPage = WebsiteVerificationExtractedPage & {
  headings: string[];
  main_text: string;
  text_char_count: number;
  links?: Array<{ href: string; text: string }>;
  images: Array<{ src: string; alt: string | null; width?: number; height?: number }>;
  json_ld: unknown[];
  emails: string[];
  favicon_urls: string[];
  logo_candidates: string[];
  hero_image_candidates: string[];
  theme_color: string | null;
  brand_color_candidates: Array<{ color: string; source: 'css' | 'meta' | 'logo' | 'dominant_page'; count?: number }>;
  same_origin_links: Array<{ href: string; text: string }>;
};

type WebsiteWorkerCrawlResult = WebsiteVerificationCrawlResult & {
  pages: RawExtractedPage[];
};

type WebsiteIntelligenceLlmCost = {
  costAmountMicros: number;
  usageQuantity: number;
  meta: Record<string, unknown>;
};

type PageFailureKind =
  | 'dns_not_resolved'
  | 'browser_error_page'
  | 'timeout'
  | 'tls_or_connection'
  | 'navigation_interrupted'
  | 'other';

const MAX_DEPTH = 3;
const MAX_PAGES = 25;
const NAV_TIMEOUT_MS = 45_000;
const SETTLE_TIMEOUT_MS = 5_000;
const COMPANY_TIMEOUT_MS = 10 * 60_000;
const VIEWPORT = { width: 1280, height: 720 };
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.WEBSITE_INTELLIGENCE_OPENROUTER_MODEL?.trim() || WEBSITE_INTELLIGENCE_DEFAULT_MODEL;

const __dirname = dirname(fileURLToPath(import.meta.url));
let extractPageBrowserSource: string | null = null;
function getExtractPageBrowserIifeSource(): string {
  if (!extractPageBrowserSource) {
    extractPageBrowserSource = readFileSync(join(__dirname, 'extractPageInBrowser.js'), 'utf8').trim();
  }
  return extractPageBrowserSource;
}

function logEvent(event: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({ source: 'website-verification', event, at: new Date().toISOString(), ...data }));
}

function normalizeCrawlUrl(raw: string): string | null {
  return normalizeWebsiteInputUrl(raw);
}

function isSameSite(seedDomain: string | null, candidateUrl: string): boolean {
  if (!seedDomain) return false;
  return registrableDomainKeyFromUrl(candidateUrl) === seedDomain;
}

function classifyPageKind(url: string, ...hints: Array<string | null | undefined>): WebsiteVerificationPageKind {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const haystack = normalizeComparableText([path, ...hints].filter(Boolean).join(' '));
  if (!path || path === '/' || /^\/home(?:[-_/a-z0-9]*)?$/.test(path)) return 'home';
  if (/(contact|contact us|get in touch|request a quote)/.test(haystack)) return 'contact';
  if (/(service|services|software|tools|products|solutions|platform|pricing|industries)/.test(haystack)) return 'services';
  if (/(team|staff|leadership|crew|meet the|management|board of directors|founder)/.test(haystack)) return 'team';
  if (/(about|our story|who we are|company)/.test(haystack)) return 'about';
  if (/(location|locations|office|offices|find us|visit us)/.test(haystack)) return 'locations';
  if (/(privacy|terms|ccpa|cookie|legal|policy)/.test(haystack)) return 'policy';
  if (/(blog|post|article|news|press|insights)/.test(haystack)) return 'blog';
  if (/(project|portfolio|gallery|case study|showcase)/.test(haystack)) return 'project';
  if (/(listing|property|community|communities|floor plan|inventory|homes)/.test(haystack)) return 'listing';
  return 'other';
}

function classifyPageFailure(message: string): PageFailureKind {
  const lower = message.toLowerCase();
  if (lower.includes('err_name_not_resolved')) return 'dns_not_resolved';
  if (lower.includes('chrome-error://chromewebdata')) return 'browser_error_page';
  if (lower.includes('timeout')) return 'timeout';
  if (
    lower.includes('err_connection') ||
    lower.includes('err_ssl') ||
    lower.includes('err_cert') ||
    lower.includes('err_tunnel')
  ) {
    return 'tls_or_connection';
  }
  if (lower.includes('interrupted by another navigation')) return 'navigation_interrupted';
  return 'other';
}

function trimPageFailureMessage(message: string): string {
  return message.split('\n')[0]?.trim() || message;
}

function companyTimeoutMessage(companyId: string, inputUrl: string): string {
  return `company verification timed out after ${Math.round(COMPANY_TIMEOUT_MS / 60_000)} minutes for ${companyId} (${inputUrl})`;
}

async function runCompanyWithTimeout<T>(
  page: Page,
  bundle: WebsiteVerificationBundle,
  inputUrl: string,
  task: () => Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const startedAt = Date.now();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const elapsedMs = Date.now() - startedAt;
      logEvent('company-timeout', {
        companyId: bundle.company_id,
        inputUrl,
        elapsed_ms: elapsedMs,
        timeout_ms: COMPANY_TIMEOUT_MS,
      });
      void page.close().catch(() => {});
      reject(new Error(companyTimeoutMessage(bundle.company_id, inputUrl)));
    }, COMPANY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([task(), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isRetryableNavigationFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('chrome-error://chromewebdata') ||
    lower.includes('interrupted by another navigation') ||
    lower.includes('err_connection_reset') ||
    lower.includes('err_connection_closed') ||
    lower.includes('err_http2_protocol_error') ||
    lower.includes('err_network_changed')
  );
}

function truncateText(value: string | null | undefined, max = 140): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`;
}

function compactText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function uniqStrings(values: Array<string | null | undefined>, max = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = compactText(value);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function safeJsonParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toWebsiteCrawlPage(page: RawExtractedPage): WebsiteCrawlPage {
  return {
    url: page.url,
    final_url: page.final_url,
    depth: page.depth,
    page_kind: page.page_kind === 'other' && /(service|solution|what we do)/i.test(`${page.url} ${page.title ?? ''} ${page.h1 ?? ''}`)
      ? 'services'
      : page.page_kind ?? 'other',
    title: page.title,
    meta_description: page.meta_description,
    h1: page.h1,
    headings: uniqStrings(page.headings ?? [], 32),
    main_text: compactText(page.main_text || page.visible_text).slice(0, 8_000),
    visible_text: compactText(page.visible_text).slice(0, 8_000),
    text_char_count: Number(page.text_char_count ?? compactText(page.main_text || page.visible_text).length) || 0,
    links: (page.same_origin_links ?? []).slice(0, 120).map((link) => ({
      href: link.href,
      text: compactText(link.text).slice(0, 160),
    })),
    images: (page.images ?? []).slice(0, 80),
    json_ld: (page.json_ld ?? []).slice(0, 25),
    phones: uniqStrings([...(page.tel_numbers ?? []), ...(page.json_ld_phones ?? [])], 20),
    emails: uniqStrings([...(page.emails ?? []), ...(page.json_ld_emails ?? [])], 20),
    social_links: uniqStrings([...(page.social_links ?? []), ...(page.same_as ?? [])], 30),
    canonical_url: page.canonical_url,
    parse_ok: page.parse_ok,
    error: page.error ?? null,
  };
}

function buildWebsiteSiteAssets(pages: RawExtractedPage[]): WebsiteSiteAssets {
  const logoCandidates: WebsiteSiteAssets['logo_candidates'] = [];
  const heroImageCandidates: string[] = [];
  const addLogo = (url: string | null | undefined, source: WebsiteSiteAssets['logo_candidates'][number]['source'], confidence: number) => {
    const normalized = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
    if (!normalized || logoCandidates.some((item) => item.url === normalized)) return;
    logoCandidates.push({ url: normalized, source, confidence });
  };
  const addHero = (url: string | null | undefined) => {
    const normalized = typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
    if (!normalized || heroImageCandidates.includes(normalized)) return;
    heroImageCandidates.push(normalized);
  };
  for (const page of pages) {
    for (const url of page.logo_candidates ?? []) addLogo(url, 'img', 0.78);
    for (const url of page.hero_image_candidates ?? []) addHero(url);
    for (const url of page.favicon_urls ?? []) addLogo(url, 'favicon', 0.35);
  }
  const colorCounts = new Map<string, { color: string; source: 'css' | 'meta' | 'logo' | 'dominant_page'; count: number }>();
  for (const page of pages) {
    if (page.theme_color) {
      colorCounts.set(page.theme_color, { color: page.theme_color, source: 'meta', count: 99 });
    }
    for (const color of page.brand_color_candidates ?? []) {
      const current = colorCounts.get(color.color);
      colorCounts.set(color.color, {
        color: color.color,
        source: color.source ?? 'css',
        count: (current?.count ?? 0) + (color.count ?? 1),
      });
    }
  }
  const orgNames = uniqStrings(
    pages.flatMap((page) => [
      page.og_site_name,
      ...(page.json_ld_names ?? []),
      ...(page.json_ld_legal_names ?? []),
      ...(page.parent_organization_names ?? []),
    ]),
    20,
  );
  return {
    logo_candidates: logoCandidates.sort((a, b) => b.confidence - a.confidence).slice(0, 12),
    hero_image_candidates: heroImageCandidates.slice(0, 5),
    favicon_urls: uniqStrings(pages.flatMap((page) => page.favicon_urls ?? []), 12),
    theme_color: pages.map((page) => page.theme_color).find((value): value is string => Boolean(value)) ?? null,
    brand_color_candidates: [...colorCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 16),
    organization_names: orgNames,
    social_profiles: uniqStrings(pages.flatMap((page) => [...(page.social_links ?? []), ...(page.same_as ?? [])]), 30),
    contact: {
      phones: uniqStrings(pages.flatMap((page) => [...(page.tel_numbers ?? []), ...(page.json_ld_phones ?? [])]), 20),
      emails: uniqStrings(pages.flatMap((page) => [...(page.emails ?? []), ...(page.json_ld_emails ?? [])]), 20),
      addresses: uniqStrings(pages.flatMap((page) => page.json_ld_addresses ?? []), 20),
    },
  };
}

function toWebsiteIntelligenceCrawl(crawl: WebsiteWorkerCrawlResult): WebsiteIntelligenceCrawlResult {
  const pages = crawl.pages.map(toWebsiteCrawlPage);
  return {
    input_url: crawl.input_url,
    final_url: crawl.final_url,
    normalized_domain_key: crawl.normalized_domain_key,
    pages,
    failed_urls: crawl.failed_urls,
    pages_visited: crawl.pages_visited,
    max_depth_reached: crawl.max_depth_reached,
    parked: crawl.parked,
    site_assets: buildWebsiteSiteAssets(crawl.pages),
  };
}

function buildEmptyWebsiteIntelligenceCrawl(inputUrl: string, error: string): WebsiteIntelligenceCrawlResult {
  return {
    input_url: inputUrl,
    final_url: null,
    normalized_domain_key: registrableDomainKeyFromUrl(inputUrl),
    pages: [],
    failed_urls: [inputUrl],
    pages_visited: 0,
    max_depth_reached: 0,
    parked: false,
    site_assets: {
      logo_candidates: [],
      hero_image_candidates: [],
      favicon_urls: [],
      theme_color: null,
      brand_color_candidates: [],
      organization_names: [],
      social_profiles: [],
      contact: { phones: [], emails: [], addresses: [] },
    },
  };
}

function buildOpenRouterMessages(siteBrief: WebsiteSiteBrief): { system: string; user: string; inputHash: string } {
  const inputHash = hashWebsiteIntelligenceInput(siteBrief);
  return {
    inputHash,
    system:
      'You extract concise business intelligence from a compact website crawl brief. Return strict JSON only. Use only evidence in the brief. Prefer null or empty arrays over guesses.',
    user: JSON.stringify({
      task: 'Summarize what this business does, who it serves, services, industries, locations, tone, confidence, and supporting URLs.',
      output_schema: {
        business_summary: 'string|null, <= 80 words',
        brand_name: 'string|null',
        audience_segments: 'string[], customer/person/company types served by this business; use concise labels like home buyers, homeowners, small businesses, marketing teams',
        services: 'string[]',
        industries_served: 'string[]',
        locations_served: 'string[]',
        tone: 'string|null',
        confidence: 'low|medium|high',
        evidence_urls: 'string[] from top_pages.url only',
      },
      site_brief: siteBrief,
    }),
  };
}

function enrichProfileFromBrief(profile: WebsiteExtractedProfile, siteBrief: WebsiteSiteBrief): WebsiteExtractedProfile {
  const text = compactText(
    [
      profile.business_summary,
      profile.services.join(' '),
      siteBrief.services_terms.join(' '),
      siteBrief.top_pages.map((page) => [page.title, page.h1, page.headings.join(' '), page.snippet].join(' ')).join(' '),
    ].join(' '),
  ).toLowerCase();
  const audience = [...profile.audience_segments];
  const addAudience = (value: string) => {
    if (!audience.some((item) => item.toLowerCase() === value.toLowerCase())) audience.push(value);
  };
  if (audience.length === 0) {
    if (/(home builder|custom home|floor plan|dream home|new home|construction)/.test(text)) {
      addAudience('Home buyers');
      addAudience('Prospective homeowners');
    } else if (/(marketing|sales|crm|customer platform|customer support|business)/.test(text)) {
      addAudience('Businesses');
      addAudience('Customer-facing teams');
    }
  }
  return { ...profile, audience_segments: audience.slice(0, 12) };
}

async function openRouterWebsiteProfile(params: {
  apiKey: string;
  model: string;
  siteBrief: WebsiteSiteBrief;
}): Promise<{ profile: WebsiteExtractedProfile; usage: Record<string, unknown>; inputHash: string; llmInputChars: number }> {
  const messages = buildOpenRouterMessages(params.siteBrief);
  const requestBody = {
    model: params.model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    temperature: 0.1,
    max_tokens: 1200,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'WebsiteExtractedProfile',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: [
            'business_summary',
            'brand_name',
            'audience_segments',
            'services',
            'industries_served',
            'locations_served',
            'tone',
            'confidence',
            'evidence_urls',
          ],
          properties: {
            business_summary: { type: ['string', 'null'] },
            brand_name: { type: ['string', 'null'] },
            audience_segments: { type: 'array', items: { type: 'string' } },
            services: { type: 'array', items: { type: 'string' } },
            industries_served: { type: 'array', items: { type: 'string' } },
            locations_served: { type: 'array', items: { type: 'string' } },
            tone: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            evidence_urls: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://furnace.ai',
      'X-OpenRouter-Title': 'Furnace Foundry Website Intelligence',
    },
    body: JSON.stringify(requestBody),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
  const text = Array.isArray(body.choices)
    ? ((body.choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content)
    : null;
  if (!response.ok) {
    const err = body.error && typeof body.error === 'object' && 'message' in body.error
      ? String((body.error as { message?: unknown }).message)
      : `OpenRouter HTTP ${response.status}`;
    throw new Error(err);
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('OpenRouter returned no completion text');
  }
  const parsed = safeJsonParseObject(text);
  const normalizedProfile = normalizeWebsiteExtractedProfile(parsed);
  const profile = normalizedProfile ? enrichProfileFromBrief(normalizedProfile, params.siteBrief) : null;
  if (!profile) throw new Error('OpenRouter profile failed schema normalization');
  const crawledUrls = new Set(params.siteBrief.top_pages.map((page) => page.url));
  profile.evidence_urls = profile.evidence_urls.filter((url) => crawledUrls.has(url));
  return {
    profile,
    usage,
    inputHash: messages.inputHash,
    llmInputChars: messages.system.length + messages.user.length,
  };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerUsageTokenCount(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n == null || n < 0) return null;
  return Math.trunc(n);
}

function extractWebsiteIntelligenceLlmCost(
  llmUsage: Record<string, unknown>,
  model: string,
): WebsiteIntelligenceLlmCost | null {
  const openRouterCostUsd = finiteNumber(llmUsage.cost);
  if (openRouterCostUsd == null || openRouterCostUsd < 0) return null;

  const promptTokens = integerUsageTokenCount(llmUsage.prompt_tokens);
  const completionTokens = integerUsageTokenCount(llmUsage.completion_tokens);
  const totalTokens =
    integerUsageTokenCount(llmUsage.total_tokens) ??
    (promptTokens != null || completionTokens != null ? (promptTokens ?? 0) + (completionTokens ?? 0) : 0);

  return {
    costAmountMicros: Math.round(openRouterCostUsd * 1_000_000),
    usageQuantity: totalTokens,
    meta: {
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      openrouter_cost_usd: openRouterCostUsd,
    },
  };
}

async function updateWebsiteIntelligenceCostStatus(
  client: any,
  intelligenceId: string,
  patch: { cost_record_id?: string | null; cost_status: 'costed' | 'failed_or_not_costed' },
): Promise<void> {
  const { error } = await (client.from('company_website_intelligence') as any)
    .update(patch)
    .eq('id', intelligenceId);
  if (error) throw new Error(error.message);
}

async function persistWebsiteIntelligenceLlmCost(args: {
  client: any;
  intelligenceId: string;
  existingCostRecordId: string | null;
  companyId: string;
  ingestionRunId: string | null;
  foundryJobId: string | null;
  llmStatus: 'not_run' | 'completed' | 'failed' | 'skipped';
  llmUsage: Record<string, unknown>;
  model: string;
  createdAt: string | null;
}): Promise<void> {
  const cost = args.llmStatus === 'completed'
    ? extractWebsiteIntelligenceLlmCost(args.llmUsage, args.model)
    : null;

  if (!cost) {
    await updateWebsiteIntelligenceCostStatus(args.client, args.intelligenceId, {
      cost_status: 'failed_or_not_costed',
    });
    return;
  }

  try {
    if (args.existingCostRecordId) {
      const { data, error } = await (args.client.from('cost_records') as any)
        .update({
          usage_quantity: cost.usageQuantity,
          usage_unit: 'token',
          cost_amount_micros: cost.costAmountMicros,
          cost_rate_card_id: null,
          cost_is_override: false,
          estimation_kind: 'vendor_direct',
          company_id: args.companyId,
          ingestion_run_id: args.ingestionRunId,
          foundry_job_id: args.foundryJobId,
          meta: cost.meta,
        })
        .eq('id', args.existingCostRecordId)
        .eq('record_kind', 'direct')
        .eq('source_entity_type', 'company_website_intelligence')
        .eq('source_entity_id', args.intelligenceId)
        .select('id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error(`Linked website intelligence cost record ${args.existingCostRecordId} was not found`);
      await updateWebsiteIntelligenceCostStatus(args.client, args.intelligenceId, {
        cost_record_id: args.existingCostRecordId,
        cost_status: 'costed',
      });
      return;
    }

    const costRecord = await insertDirectCostRecord(args.client as any, {
      costKind: 'enrichment',
      provider: 'openrouter',
      product: 'website_intelligence_llm',
      usageQuantity: cost.usageQuantity,
      usageUnit: 'token',
      costAmountMicros: cost.costAmountMicros,
      costRateCardId: null,
      costIsOverride: false,
      estimationKind: 'vendor_direct',
      sourceEntityType: 'company_website_intelligence',
      sourceEntityId: args.intelligenceId,
      companyId: args.companyId,
      ingestionRunId: args.ingestionRunId,
      foundryJobId: args.foundryJobId,
      meta: cost.meta,
      createdAt: args.createdAt ?? new Date().toISOString(),
    });
    await updateWebsiteIntelligenceCostStatus(args.client, args.intelligenceId, {
      cost_record_id: costRecord.id,
      cost_status: 'costed',
    });
  } catch (costError) {
    console.error('website intelligence cost write failed', args.intelligenceId, costError);
    if (!args.existingCostRecordId) {
      await updateWebsiteIntelligenceCostStatus(args.client, args.intelligenceId, {
        cost_status: 'failed_or_not_costed',
      });
    }
  }
}

function bundleLogView(bundle: WebsiteVerificationBundle, inputUrl: string | null) {
  return {
    company_id: bundle.company_id,
    legal_name: bundle.legal_name,
    normalized_key: bundle.normalized_key,
    chosen_input_url: inputUrl,
    locations: bundle.locations.slice(0, 3).map((loc) => ({
      city: loc.city,
      state_region: loc.state_region,
      postal_code: loc.postal_code,
      is_primary: loc.is_primary,
    })),
    source_records: bundle.source_records.slice(0, 5).map((row) => ({
      source_business_record_id: row.source_business_record_id,
      link_status: row.link_status,
      link_score: row.link_score,
      website: row.website,
      phone: row.phone,
      city: row.city,
      state_region: row.state_region,
    })),
    registry_entities: bundle.registry_entities.slice(0, 5).map((entity) => ({
      id: entity.id,
      registry_state: entity.registry_state,
      legal_name: entity.legal_name,
    })),
    owners: bundle.owners.slice(0, 8).map((owner) => ({
      owner_name: owner.owner_name,
      title_role: owner.title_role,
    })),
  };
}

function crawlLogView(crawl: WebsiteVerificationCrawlResult) {
  return {
    input_url: crawl.input_url,
    final_url: crawl.final_url,
    normalized_domain_key: crawl.normalized_domain_key,
    pages_visited: crawl.pages_visited,
    max_depth_reached: crawl.max_depth_reached,
    parked: crawl.parked,
    failed_urls: crawl.failed_urls,
    pages: crawl.pages.slice(0, 5).map((page) => ({
      url: page.url,
      depth: page.depth,
      page_kind: page.page_kind ?? 'other',
      title: truncateText(page.title, 100),
      h1: truncateText(page.h1, 100),
      json_ld_types: page.json_ld_types.slice(0, 8),
      social_links: page.social_links.slice(0, 5),
      map_links: page.map_links.slice(0, 5),
    })),
  };
}

function scoreLogView(scored: WebsiteVerificationScoredResult) {
  return {
    score: scored.score,
    band: scored.band,
    dimensions: scored.signals.dimensions,
    vetoes: scored.signals.vetoes,
    contradictions: scored.signals.contradictions,
    brand_confident: scored.signals.brand_confident,
    chosen_domain: scored.signals.chosen_domain,
    domain_brand_score: scored.signals.domain_brand_score,
    geographic_evidence: scored.signals.geographic_evidence,
    expected_name_candidates: scored.signals.expected_name_candidates,
    owner_name_count: scored.signals.owner_name_count,
    crawl_stats: scored.crawl_stats,
  };
}

function scoreLinkPriority(bundle: WebsiteVerificationBundle, url: string, text: string): number {
  const lower = `${url} ${text}`.toLowerCase();
  let score = 0;
  const kind = classifyPageKind(url, text);
  if (kind === 'home') score += 8;
  if (kind === 'services') score += 12;
  if (kind === 'contact' || kind === 'about' || kind === 'team' || kind === 'locations') score += 10;
  if (kind === 'listing') score += 4;
  if (kind === 'project') score += 2;
  if (kind === 'policy' || kind === 'blog') score -= 6;
  if (/(login|cart|checkout|account|calendar|event)/.test(lower)) score -= 4;
  const nameTokens = normalizeComparableText(bundle.legal_name)
    .split(/\s+/)
    .filter((token: string) => token.length >= 3);
  for (const token of nameTokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
}

async function fetchSecretFromParameterStore(parameterPath: string, region: string): Promise<string> {
  const ssmClient = new SSMClient({ region });
  const response = await ssmClient.send(new GetParameterCommand({ Name: parameterPath, WithDecryption: true }));
  if (!response.Parameter?.Value?.trim()) {
    throw new Error(`Parameter ${parameterPath} has no value`);
  }
  return response.Parameter.Value.trim();
}

async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

async function extractPage(page: Page, depth: number): Promise<RawExtractedPage> {
  const iife = getExtractPageBrowserIifeSource();
  const expr = `${iife}(${JSON.stringify(depth)})`;
  const extracted = await (page.evaluate(expr) as Promise<RawExtractedPage>);
  return {
    ...extracted,
    page_kind: classifyPageKind(extracted.url, extracted.title, extracted.h1, extracted.og_site_name),
  };
}

function isParkedPage(page: RawExtractedPage): boolean {
  const haystack = normalizeComparableText(
    [page.title, page.meta_description, page.h1, page.visible_text].filter(Boolean).join(' '),
  );
  return /(domain for sale|buy this domain|parked free|sedo|afternic|huge domains|this domain is available)/.test(haystack);
}

async function visitUrl(page: Page, url: string, depth: number): Promise<RawExtractedPage> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
      return extractPage(page, depth);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 2 || !isRetryableNavigationFailure(message)) break;
      logEvent('page-retry', {
        url,
        depth,
        attempt,
        error: trimPageFailureMessage(message),
      });
      await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function crawlWebsite(
  page: Page,
  bundle: WebsiteVerificationBundle,
  inputUrl: string,
): Promise<WebsiteWorkerCrawlResult> {
  const normalizedSeed = normalizeCrawlUrl(inputUrl);
  if (!normalizedSeed) {
    throw new Error(`Invalid input URL: ${inputUrl}`);
  }
  const queue: Array<{ url: string; depth: number; viaText: string }> = [{ url: normalizedSeed, depth: 0, viaText: '' }];
  const visited = new Set<string>();
  const pages: RawExtractedPage[] = [];
  const failedUrls: string[] = [];
  let finalUrl: string | null = null;
  let seedDomain: string | null = registrableDomainKeyFromUrl(normalizedSeed);
  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const next = queue.shift()!;
    if (next.depth > MAX_DEPTH) continue;
    const normalizedUrl = normalizeCrawlUrl(next.url);
    if (!normalizedUrl || visited.has(normalizedUrl)) continue;
    if (seedDomain && !isSameSite(seedDomain, normalizedUrl)) continue;
    visited.add(normalizedUrl);
    try {
      const extracted = await visitUrl(page, normalizedUrl, next.depth);
      pages.push(extracted);
      finalUrl = finalUrl || extracted.final_url;
      seedDomain = registrableDomainKeyFromUrl(finalUrl ?? normalizedSeed) ?? seedDomain;
      if (pages.length >= MAX_PAGES || next.depth >= MAX_DEPTH) continue;
      const candidates = extracted.same_origin_links
        .map((item) => {
          const href = normalizeCrawlUrl(item.href);
          if (!href) return null;
          return { href, text: item.text };
        })
        .filter((item): item is { href: string; text: string } => Boolean(item))
        .filter((item) => !visited.has(item.href))
        .filter((item) => isSameSite(seedDomain, item.href))
        .map((item) => ({
          href: item.href,
          text: item.text,
          priority: scoreLinkPriority(bundle, item.href, item.text),
          kind: classifyPageKind(item.href, item.text),
        }))
        .sort(
          (a, b) =>
            b.priority - a.priority || a.href.localeCompare(b.href),
        )
        .slice(0, 25);
      const identityCandidates = candidates.filter((candidate) =>
        ['contact', 'about', 'team', 'locations', 'home'].includes(candidate.kind),
      );
      const remainingCandidates = candidates.filter((candidate) => !identityCandidates.includes(candidate));
      for (const candidate of [...identityCandidates.slice(0, 8), ...remainingCandidates.slice(0, 12)]) {
        queue.push({ url: candidate.href, depth: next.depth + 1, viaText: candidate.text });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureKind = classifyPageFailure(message);
      failedUrls.push(normalizedUrl);
      logEvent('page-unreachable', {
        companyId: bundle.company_id,
        url: normalizedUrl,
        depth: next.depth,
        reason: failureKind,
        error: trimPageFailureMessage(message),
      });
    }
  }
  return {
    input_url: normalizedSeed,
    final_url: finalUrl,
    normalized_domain_key: registrableDomainKeyFromUrl(finalUrl ?? normalizedSeed),
    pages,
    failed_urls: failedUrls,
    pages_visited: pages.length,
    max_depth_reached: pages.reduce((max, item) => Math.max(max, item.depth), 0),
    parked: pages.some(isParkedPage),
  };
}

async function loadSecret(): Promise<{ url: string; key: string; jobId: string; openRouterApiKey: string | null }> {
  const url = process.env.LEADS_SUPABASE_URL?.trim();
  const jobId = process.env.JOB_ID?.trim();
  let key = process.env.LEADS_SUPABASE_SECRET_KEY?.trim();
  const paramPath = process.env.LEADS_SUPABASE_SECRET_KEY_PARAM_PATH?.trim();
  let openRouterApiKey = process.env.FOUNDRY_OPENROUTER_API_KEY?.trim() || null;
  const openRouterParamPath = process.env.FOUNDRY_OPENROUTER_API_KEY_PARAM_PATH?.trim();
  const region = process.env.AWS_REGION || 'us-west-2';
  if (!url || !jobId) {
    throw new Error('Missing LEADS_SUPABASE_URL or JOB_ID');
  }
  if (!key && paramPath) {
    key = await fetchSecretFromParameterStore(paramPath, region);
  }
  if (!key) {
    throw new Error('Missing LEADS_SUPABASE_SECRET_KEY or LEADS_SUPABASE_SECRET_KEY_PARAM_PATH');
  }
  if (!openRouterApiKey && openRouterParamPath) {
    openRouterApiKey = await fetchSecretFromParameterStore(openRouterParamPath, region);
  }
  return { url, key, jobId, openRouterApiKey };
}

async function updateJobProgress(client: any, jobId: string, progress: JobProgress): Promise<void> {
  const { error } = await (client
    .from('foundry_jobs') as any)
    .update({ progress: { ...progress, current_step: 'running' } })
    .eq('id', jobId);
  if (error) {
    throw new Error(error.message);
  }
}

async function refreshWebsiteVerificationProgress(
  client: any,
  jobId: string,
  payload: Record<string, unknown>,
  previous: JobProgress,
  currentStep: string,
): Promise<JobProgress> {
  const counts = await loadWebsiteVerificationProgressCounts(
    client as unknown as Parameters<typeof loadWebsiteVerificationProgressCounts>[0],
    jobId,
  );
  const progress = buildWebsiteVerificationProgressSnapshot(payload, counts, {
    current_step: currentStep,
    previous,
  }) as JobProgress;
  const { error } = await (client.from('foundry_jobs') as any).update({ progress }).eq('id', jobId);
  if (error) {
    throw new Error(error.message);
  }
  return progress;
}

type CsvBuilderRowRecord = {
  id: string;
  row_number: number;
  source_values: Record<string, unknown>;
  tool_values: Record<string, unknown>;
  row_status: string;
};

type CsvBuilderOutputColumn = {
  id: string;
  key: string;
  tool_output_key: string | null;
};

type CsvBuilderBatchRow = {
  id: string;
  batch_index: number;
  row_ids: string[];
  row_count: number;
  status: string;
  attempt_count: number;
};

async function loadCsvBuilderBatch(client: any, batchId: string): Promise<CsvBuilderBatchRow> {
  const { data, error } = await client
    .from('csv_builder_tool_job_batches')
    .select('id, batch_index, row_ids, row_count, status, attempt_count')
    .eq('id', batchId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? `CSV Builder batch ${batchId} not found`);
  return data as CsvBuilderBatchRow;
}

async function loadCsvBuilderRowsForBatch(
  client: any,
  rowIds: string[],
): Promise<CsvBuilderRowRecord[]> {
  if (rowIds.length === 0) return [];
  const { data, error } = await client
    .from('csv_builder_rows')
    .select('id, row_number, source_values, tool_values, row_status')
    .in('id', rowIds);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CsvBuilderRowRecord[]).sort((a, b) => a.row_number - b.row_number);
}

function csvBuilderRowValues(
  row: CsvBuilderRowRecord,
  columnIdToKey: Map<string, string>,
  inputMapping: Record<string, string>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [inputKey, columnId] of Object.entries(inputMapping)) {
    const columnKey = columnIdToKey.get(columnId);
    if (!columnKey) continue;
    if (Object.prototype.hasOwnProperty.call(row.tool_values ?? {}, columnKey)) {
      values[inputKey] = row.tool_values[columnKey];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(row.source_values ?? {}, columnKey)) {
      values[inputKey] = row.source_values[columnKey];
      continue;
    }
    values[inputKey] = null;
  }
  return values;
}

async function refreshCsvBuilderWebsiteProgress(
  client: any,
  jobId: string,
  toolJobId: string,
  payload: Record<string, unknown>,
  previous: JobProgress,
): Promise<JobProgress> {
  const counts = await loadCsvBuilderWebsiteVerificationToolJobProgressCounts(
    client as unknown as Parameters<typeof loadCsvBuilderWebsiteVerificationToolJobProgressCounts>[0],
    toolJobId,
  );
  const progress = buildCsvBuilderWebsiteVerificationToolJobProgressSnapshot(payload, counts, {
    status: 'running',
    previous,
  }) as JobProgress;
  await updateJobProgress(client, jobId, progress);
  const { error } = await client
    .from('csv_builder_column_jobs')
    .update({
      status: 'running',
      rows_total: counts.rows_total,
      rows_completed: counts.rows_completed,
      rows_failed: counts.rows_failed,
      completed_at: null,
      error_summary: counts.rows_failed > 0 ? `${counts.rows_failed} rows failed` : null,
    })
    .eq('id', toolJobId);
  if (error) throw new Error(error.message);
  return progress;
}

async function persistCrawlAndIntelligence(args: {
  client: any;
  bundle: WebsiteVerificationBundle;
  jobId: string;
  sourceIngestionRunId: string | null;
  crawl: WebsiteIntelligenceCrawlResult;
  elapsedMs: number;
  openRouterApiKey: string | null;
  crawlError?: string | null;
}): Promise<{
  crawlId: string | null;
  intelligenceId: string | null;
  validationReport: WebsiteIntelligenceValidationReport;
  siteBrief: WebsiteSiteBrief;
}> {
  const siteBrief = buildWebsiteSiteBrief(args.crawl);
  const inputHash = hashWebsiteIntelligenceInput(siteBrief);
  let crawlId: string | null = null;
  let intelligenceId: string | null = null;
  let profile: WebsiteExtractedProfile | null = null;
  let llmStatus: 'not_run' | 'completed' | 'failed' | 'skipped' = 'not_run';
  let llmUsage: Record<string, unknown> = {};
  let llmError: string | null = null;
  let llmInputChars = JSON.stringify(siteBrief).length;
  const crawlWrite = await upsertCompanyWebsiteCrawl(args.client, {
    companyId: args.bundle.company_id,
    foundryJobId: args.jobId,
    sourceIngestionRunId: args.sourceIngestionRunId,
    crawl: args.crawl,
    maxDepth: MAX_DEPTH,
    maxPages: MAX_PAGES,
    elapsedMs: args.elapsedMs,
    error: args.crawlError ?? null,
  });
  crawlId = crawlWrite.id;
  if (args.crawl.pages_visited === 0) {
    llmStatus = 'skipped';
    llmError = args.crawlError ?? 'No crawl pages available for LLM profile';
  } else if (!args.openRouterApiKey) {
    llmStatus = 'failed';
    llmError = 'Missing FOUNDRY_OPENROUTER_API_KEY or FOUNDRY_OPENROUTER_API_KEY_PARAM_PATH';
  } else {
    try {
      const llm = await openRouterWebsiteProfile({
        apiKey: args.openRouterApiKey,
        model: OPENROUTER_MODEL,
        siteBrief,
      });
      profile = llm.profile;
      llmUsage = llm.usage;
      llmInputChars = llm.llmInputChars;
      llmStatus = 'completed';
    } catch (error) {
      llmStatus = 'failed';
      llmError = error instanceof Error ? trimPageFailureMessage(error.message) : String(error);
    }
  }
  const generatedAt = llmStatus === 'completed' ? new Date().toISOString() : null;
  const intelligence = await upsertCompanyWebsiteIntelligence(args.client, {
    companyId: args.bundle.company_id,
    websiteCrawlId: crawlId,
    foundryJobId: args.jobId,
    sourceIngestionRunId: args.sourceIngestionRunId,
    inputHash,
    siteBrief,
    extractedProfile: profile,
    llmStatus,
    llmUsage,
    error: llmError,
    modelProvider: WEBSITE_INTELLIGENCE_MODEL_PROVIDER,
    model: OPENROUTER_MODEL,
    generatedAt,
  });
  intelligenceId = intelligence.id;
  await persistWebsiteIntelligenceLlmCost({
    client: args.client,
    intelligenceId,
    existingCostRecordId: intelligence.costRecordId,
    companyId: args.bundle.company_id,
    ingestionRunId: args.sourceIngestionRunId,
    foundryJobId: args.jobId,
    llmStatus,
    llmUsage,
    model: OPENROUTER_MODEL,
    createdAt: generatedAt,
  });
  const validationReport = buildWebsiteIntelligenceValidationReport({
    crawl: args.crawl,
    siteBrief,
    profile,
    llmInputChars,
    persisted: {
      crawlId,
      intelligenceId,
    },
  });
  logEvent('website-intelligence-result', {
    companyId: args.bundle.company_id,
    crawlId,
    intelligenceId,
    llm_status: llmStatus,
    validation: {
      ok: validationReport.ok,
      errors: validationReport.errors,
      warnings: validationReport.warnings,
      metrics: validationReport.metrics,
    },
  });
  return { crawlId, intelligenceId, validationReport, siteBrief };
}

function slugForUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'site';
  } catch {
    return raw.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'site';
  }
}

function localBundleForUrl(url: string): WebsiteVerificationBundle {
  let host = 'Local Website';
  try {
    host = new URL(canonicalizeWebsiteUrl(url) ?? url).hostname.replace(/^www\./, '');
  } catch {
    // keep fallback
  }
  return {
    company_id: `local:${slugForUrl(url)}`,
    legal_name: host,
    normalized_key: host.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    notes: 'local_website_intelligence_validation',
    locations: [],
    source_records: [
      {
        source_business_record_id: `local-source:${slugForUrl(url)}`,
        link_status: 'linked',
        link_score: 1,
        website: url,
        phone: null,
        address_raw: null,
        line1: null,
        city: null,
        state_region: null,
        postal_code: null,
        categories: [],
        raw_payload: {},
        resolution_meta: {},
      },
    ],
    registry_entities: [],
    owners: [],
  };
}

async function runLocalWebsiteIntelligence(): Promise<void> {
  const rawUrls = process.argv.slice(2).filter((arg) => /^https?:\/\//i.test(arg) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(arg));
  const envUrls = process.env.LOCAL_WEBSITE_URLS_JSON?.trim()
    ? JSON.parse(process.env.LOCAL_WEBSITE_URLS_JSON) as unknown
    : [];
  const urls = [
    ...rawUrls,
    ...(Array.isArray(envUrls) ? envUrls.filter((item): item is string => typeof item === 'string') : []),
  ].map((url) => canonicalizeWebsiteUrl(url)).filter((url): url is string => Boolean(url));
  if (urls.length === 0) {
    throw new Error('Provide URLs as CLI args or LOCAL_WEBSITE_URLS_JSON for RUN_MODE=local-intelligence');
  }
  const outputRoot = process.env.WEBSITE_INTELLIGENCE_OUTPUT_DIR?.trim() || join(process.cwd(), 'tmp/website-intelligence-runs');
  mkdirSync(outputRoot, { recursive: true });
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  try {
    for (const inputUrl of urls) {
      const startedAt = Date.now();
      const slug = slugForUrl(inputUrl);
      const outputDir = join(outputRoot, slug);
      mkdirSync(outputDir, { recursive: true });
      const bundle = localBundleForUrl(inputUrl);
      const page = await context.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);
      let intelligenceCrawl: WebsiteIntelligenceCrawlResult;
      let siteBrief: WebsiteSiteBrief;
      let profile: WebsiteExtractedProfile | null = null;
      let llmOutput: Record<string, unknown> = {};
      let llmInputChars = 0;
      try {
        const crawl = await runCompanyWithTimeout(page, bundle, inputUrl, async () => await crawlWebsite(page, bundle, inputUrl));
        intelligenceCrawl = toWebsiteIntelligenceCrawl(crawl);
        siteBrief = buildWebsiteSiteBrief(intelligenceCrawl);
        const llmMessages = buildOpenRouterMessages(siteBrief);
        llmInputChars = llmMessages.system.length + llmMessages.user.length;
        if (process.env.FOUNDRY_OPENROUTER_API_KEY?.trim()) {
          const llm = await openRouterWebsiteProfile({
            apiKey: process.env.FOUNDRY_OPENROUTER_API_KEY.trim(),
            model: OPENROUTER_MODEL,
            siteBrief,
          });
          profile = llm.profile;
          llmOutput = { status: 'completed', profile, usage: llm.usage, model: OPENROUTER_MODEL };
          llmInputChars = llm.llmInputChars;
        } else {
          llmOutput = { status: 'skipped', error: 'Missing FOUNDRY_OPENROUTER_API_KEY for local LLM run', model: OPENROUTER_MODEL };
        }
      } catch (error) {
        const message = error instanceof Error ? trimPageFailureMessage(error.message) : String(error);
        intelligenceCrawl = buildEmptyWebsiteIntelligenceCrawl(inputUrl, message);
        siteBrief = buildWebsiteSiteBrief(intelligenceCrawl);
        llmOutput = { status: 'failed', error: message, model: OPENROUTER_MODEL };
      } finally {
        await page.close().catch(() => {});
      }
      const validationReport = buildWebsiteIntelligenceValidationReport({
        crawl: intelligenceCrawl,
        siteBrief,
        profile,
        llmInputChars,
      });
      writeFileSync(join(outputDir, 'crawl.json'), JSON.stringify(intelligenceCrawl, null, 2));
      writeFileSync(join(outputDir, 'site-brief.json'), JSON.stringify(siteBrief, null, 2));
      writeFileSync(join(outputDir, 'llm-input.json'), JSON.stringify(buildOpenRouterMessages(siteBrief), null, 2));
      writeFileSync(join(outputDir, 'llm-output.json'), JSON.stringify(llmOutput, null, 2));
      writeFileSync(join(outputDir, 'validation-report.json'), JSON.stringify(validationReport, null, 2));
      logEvent('local-website-intelligence-result', {
        inputUrl,
        outputDir,
        elapsed_ms: Date.now() - startedAt,
        ok: validationReport.ok,
        errors: validationReport.errors,
        warnings: validationReport.warnings,
      });
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function runCsvBuilderWebsiteVerification(
  client: any,
  jobId: string,
  payload: Record<string, unknown>,
  previousProgress: JobProgress,
): Promise<void> {
  const toolJobId =
    typeof payload.csv_builder_tool_job_id === 'string' && payload.csv_builder_tool_job_id.trim().length > 0
      ? payload.csv_builder_tool_job_id.trim()
      : null;
  const runId = typeof payload.run_id === 'string' && payload.run_id.trim().length > 0 ? payload.run_id.trim() : null;
  const batchId = process.env.CSV_BUILDER_BATCH_ID?.trim() || null;
  if (!toolJobId || !runId || !batchId) throw new Error('Missing CSV Builder tool job payload');
  const { data: toolJob, error: toolJobErr } = await client
    .from('csv_builder_column_jobs')
    .select('*')
    .eq('id', toolJobId)
    .maybeSingle();
  if (toolJobErr || !toolJob) throw new Error(toolJobErr?.message ?? `CSV Builder tool job ${toolJobId} not found`);
  const { data: columnsData, error: columnsErr } = await client
    .from('csv_builder_columns')
    .select('id, key, tool_output_key')
    .eq('run_id', runId);
  if (columnsErr) throw new Error(columnsErr.message);
  const columns = (columnsData ?? []) as Array<{ id: string; key: string; tool_output_key: string | null }>;
  const columnIdToKey = new Map(columns.map((column) => [column.id, column.key]));
  const outputColumns = columns.filter((column) => (toolJob.output_column_ids ?? []).includes(column.id)) as CsvBuilderOutputColumn[];
  const batch = await loadCsvBuilderBatch(client, batchId);
  const { error: batchStartErr } = await client
    .from('csv_builder_tool_job_batches')
    .update({
      status: 'running',
      attempt_count: Math.max(0, Math.trunc(Number(batch.attempt_count ?? 0) || 0)) + 1,
      started_at: new Date().toISOString(),
      completed_at: null,
      error_summary: null,
    })
    .eq('id', batchId);
  if (batchStartErr) throw new Error(batchStartErr.message);
  const rows = await loadCsvBuilderRowsForBatch(client, batch.row_ids ?? []);
  let progress = await refreshCsvBuilderWebsiteProgress(client, jobId, toolJobId, payload, previousProgress);
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  try {
    let processedSinceRefresh = 0;
    for (const row of rows) {
      const rowValues = csvBuilderRowValues(row, columnIdToKey, (toolJob.config?.input_mapping ?? {}) as Record<string, string>);
      const bundle = buildCsvBuilderWebsiteVerificationBundle(rowValues, toolJob.config, row.id);
      const inputUrl = pickCsvBuilderWebsiteInputUrl(rowValues, toolJob.config);
      const page = await context.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);
      let result: Record<string, unknown>;
      let failed = false;
      let status: 'completed' | 'failed' | 'skipped' = 'completed';
      let outcomeCode: 'usable' | 'uncertain' | 'not_usable' | null = null;
      let errorSummary: string | null = null;
      try {
        if (!inputUrl) {
          failed = true;
          status = 'failed';
          errorSummary = 'Missing website input';
          result = buildCsvBuilderWebsiteVerificationErrorResult(null, 'Missing website input');
        } else {
          const crawl = await runCompanyWithTimeout(page, bundle, inputUrl, async () => await crawlWebsite(page, bundle, inputUrl));
          const scored = scoreWebsiteVerification(bundle, crawl);
          result = buildCsvBuilderWebsiteVerificationRowResult({ crawl, scored });
          outcomeCode = scored.band;
        }
      } catch (error) {
        failed = true;
        status = 'failed';
        const message = error instanceof Error ? trimPageFailureMessage(error.message) : String(error);
        errorSummary = message;
        result = buildCsvBuilderWebsiteVerificationErrorResult(inputUrl, message);
      } finally {
        await page.close().catch(() => {});
      }
      const patch: Record<string, unknown> = {};
      for (const column of outputColumns) {
        if (!column.tool_output_key) continue;
        patch[column.key] = extractCsvBuilderToolOutputValue('website_verification', column.tool_output_key, result) ?? null;
      }
      const { error: applyErr } = await client.rpc('apply_csv_builder_tool_job_row_result', {
        p_tool_job_id: toolJobId,
        p_batch_id: batchId,
        p_row_id: row.id,
        p_row_number: row.row_number,
        p_tool_type: 'website_verification',
        p_status: status,
        p_failed: failed,
        p_outcome_code: outcomeCode,
        p_error_summary: errorSummary,
        p_result_payload: result,
        p_output_patch: patch,
      });
      if (applyErr) throw new Error(applyErr.message);
      processedSinceRefresh += 1;
      if (processedSinceRefresh >= 5 || processedSinceRefresh === rows.length) {
        progress = await refreshCsvBuilderWebsiteProgress(client, jobId, toolJobId, payload, progress);
        processedSinceRefresh = 0;
      }
    }
    const { error: batchCompleteErr } = await client
      .from('csv_builder_tool_job_batches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_summary: null,
      })
      .eq('id', batchId);
    if (batchCompleteErr) throw new Error(batchCompleteErr.message);
    await refreshCsvBuilderWebsiteProgress(client, jobId, toolJobId, payload, progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client
      .from('csv_builder_tool_job_batches')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: message,
      })
      .eq('id', batchId);
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  if (process.env.RUN_MODE === 'local-intelligence') {
    await runLocalWebsiteIntelligence();
    return;
  }
  const { url, key, jobId, openRouterApiKey } = await loadSecret();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const runtimeCost = await resolveRunCost(
    client as any,
    'enrichment',
    'furnace_runtime',
    'website_verification_ms',
    undefined,
    { usageUnit: 'ms', unitQuantity: 3600000 },
  );
  const { data: jobRow, error: jobErr } = await client
    .from('foundry_jobs')
    .select('payload, progress')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr || !jobRow) {
    throw new Error(jobErr?.message || `Job ${jobId} not found`);
  }
  const payload = (jobRow.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.csv_builder_tool_job_id === 'string' && payload.csv_builder_tool_job_id.trim().length > 0) {
    await runCsvBuilderWebsiteVerification(client, jobId, payload, ((jobRow.progress ?? {}) as JobProgress) || {});
    return;
  }
  const progress = ((jobRow.progress ?? {}) as JobProgress) || {};
  const envCompanyIds = process.env.COMPANY_IDS_JSON?.trim();
  const batchIndex =
    Number.isFinite(Number(process.env.BATCH_INDEX)) && process.env.BATCH_INDEX != null
      ? Math.max(0, Math.trunc(Number(process.env.BATCH_INDEX)))
      : null;
  const batchTotal =
    Number.isFinite(Number(process.env.BATCH_TOTAL)) && process.env.BATCH_TOTAL != null
      ? Math.max(1, Math.trunc(Number(process.env.BATCH_TOTAL)))
      : null;
  const companyIds = (() => {
    if (envCompanyIds) {
      try {
        const parsed = JSON.parse(envCompanyIds);
        if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
      } catch {
        // fall through to payload
      }
    }
    if (Array.isArray(payload.ready_company_ids)) {
      return payload.ready_company_ids.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
    return Array.isArray(payload.company_ids) ? payload.company_ids.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
  })();
  const sourceIngestionRunId =
    typeof payload.source_ingestion_run_id === 'string' && payload.source_ingestion_run_id.trim().length > 0
      ? payload.source_ingestion_run_id.trim()
      : null;

  progress.in_scope_total = progress.in_scope_total ?? companyIds.length;
  progress.companies_processed = progress.companies_processed ?? 0;
  progress.outcome_usable = progress.outcome_usable ?? 0;
  progress.outcome_uncertain = progress.outcome_uncertain ?? 0;
  progress.outcome_not_usable = progress.outcome_not_usable ?? 0;
  progress.outcome_error = progress.outcome_error ?? 0;
  progress.outcome_skipped = progress.outcome_skipped ?? 0;
  progress.companies_with_result = progress.companies_with_result ?? 0;

  logEvent('worker-start', {
    jobId,
    companies: companyIds.length,
    sourceIngestionRunId,
    batch_index: batchIndex,
    batch_total: batchTotal,
    batch_size: companyIds.length,
  });
  const bundles = await loadWebsiteVerificationBundles(
    client as unknown as Parameters<typeof loadWebsiteVerificationBundles>[0],
    companyIds,
  );
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  try {
    for (const bundle of bundles) {
      const verificationStartedAt = Date.now();
      const inputUrl = pickWebsiteVerificationTarget(bundle);
      logEvent('company-start', {
        jobId,
        companyId: bundle.company_id,
        batch_index: batchIndex,
        batch_total: batchTotal,
        company: bundleLogView(bundle, inputUrl),
      });
      if (!inputUrl) {
        logEvent('company-skipped', {
          jobId,
          companyId: bundle.company_id,
          batch_index: batchIndex,
          batch_total: batchTotal,
          reason: 'missing_input_url',
          company: bundleLogView(bundle, inputUrl),
        });
        progress.last_progress_refresh_at = new Date().toISOString();
        await updateJobProgress(client, jobId, progress);
        continue;
      }
      const page = await context.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);
      try {
        await runCompanyWithTimeout(page, bundle, inputUrl, async () => {
          const crawl = await crawlWebsite(page, bundle, inputUrl);
          const elapsedMs = Math.max(0, Date.now() - verificationStartedAt);
          const intelligenceCrawl = toWebsiteIntelligenceCrawl(crawl);
          const intelligence = await persistCrawlAndIntelligence({
            client,
            bundle,
            jobId,
            sourceIngestionRunId,
            crawl: intelligenceCrawl,
            elapsedMs,
            openRouterApiKey,
          });
          const scored = scoreWebsiteVerification(bundle, crawl);
          const verifiedAt = new Date().toISOString();
          logEvent('company-result', {
            jobId,
            companyId: bundle.company_id,
            batch_index: batchIndex,
            batch_total: batchTotal,
            company: bundleLogView(bundle, inputUrl),
            crawl: crawlLogView(crawl),
            result: scoreLogView(scored),
            website_crawl_id: intelligence.crawlId,
            website_intelligence_id: intelligence.intelligenceId,
          });
          const { data: written, error } = await (client.from('company_website_verifications') as any).upsert({
            company_id: bundle.company_id,
            foundry_job_id: jobId,
            website_crawl_id: intelligence.crawlId,
            source_ingestion_run_id: sourceIngestionRunId,
            input_url: crawl.input_url,
            final_url: crawl.final_url,
            score: scored.score,
            band: scored.band,
            signals: scored.signals,
            verifier_version: WEBSITE_VERIFIER_VERSION,
            crawl_stats: scored.crawl_stats,
            elapsed_ms: elapsedMs,
            cost_status: runtimeCost != null ? 'costed' : 'failed_or_not_costed',
            verified_at: verifiedAt,
          }, { onConflict: 'foundry_job_id,company_id', ignoreDuplicates: false }).select('id, cost_record_id').single();
          if (error) throw new Error(error.message);
          const verificationId = String(written?.id ?? '');
          if (!verificationId) throw new Error('Website verification upsert did not return an id');
          if (runtimeCost != null) {
            try {
              const costAmountMicros = computeCostAmountMicros({
                usageQuantity: elapsedMs,
                unitPriceCents: runtimeCost.unitPriceCents,
                unitQuantity: runtimeCost.unitQuantity,
              });
              const existingVerificationCostRecordId =
                written?.cost_record_id == null ? null : String(written.cost_record_id);
              const costRecord = existingVerificationCostRecordId
                ? await (async () => {
                    const { data, error: costUpdateError } = await (client.from('cost_records') as any)
                      .update({
                        usage_quantity: elapsedMs,
                        usage_unit: 'ms',
                        cost_amount_micros: costAmountMicros,
                        cost_rate_card_id: runtimeCost.rateCardId,
                        cost_is_override: runtimeCost.isOverride,
                        estimation_kind: 'runtime_estimate',
                        company_id: bundle.company_id,
                        ingestion_run_id: sourceIngestionRunId,
                        foundry_job_id: jobId,
                        meta: { band: scored.band, website_crawl_id: intelligence.crawlId },
                      })
                      .eq('id', existingVerificationCostRecordId)
                      .eq('record_kind', 'direct')
                      .eq('source_entity_type', 'company_website_verification')
                      .eq('source_entity_id', verificationId)
                      .select('id')
                      .maybeSingle();
                    if (costUpdateError) throw new Error(costUpdateError.message);
                    if (!data?.id) {
                      throw new Error(`Linked website verification cost record ${existingVerificationCostRecordId} was not found`);
                    }
                    return { id: existingVerificationCostRecordId };
                  })()
                : await insertDirectCostRecord(client as any, {
                    costKind: 'enrichment',
                    provider: 'furnace_runtime',
                    product: 'website_verification_ms',
                    usageQuantity: elapsedMs,
                    usageUnit: 'ms',
                    costAmountMicros,
                    costRateCardId: runtimeCost.rateCardId,
                    costIsOverride: runtimeCost.isOverride,
                    estimationKind: 'runtime_estimate',
                    sourceEntityType: 'company_website_verification',
                    sourceEntityId: verificationId,
                    companyId: bundle.company_id,
                    ingestionRunId: sourceIngestionRunId,
                    foundryJobId: jobId,
                    meta: { band: scored.band, website_crawl_id: intelligence.crawlId },
                    createdAt: verifiedAt,
                  });
              const { error: updError } = await (client.from('company_website_verifications') as any)
                .update({ cost_record_id: costRecord.id, cost_status: 'costed' })
                .eq('id', verificationId);
              if (updError) throw new Error(updError.message);
            } catch (costError) {
              console.error('website verification cost write failed', verificationId, costError);
              await (client.from('company_website_verifications') as any)
                .update({ cost_status: 'failed_or_not_costed' })
                .eq('id', verificationId);
            }
          }
          const refreshed = await refreshWebsiteVerificationProgress(client, jobId, payload, progress, 'running');
          Object.assign(progress, refreshed);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const elapsedMs = Math.max(0, Date.now() - verificationStartedAt);
        let crawlId: string | null = null;
        let intelligenceId: string | null = null;
        try {
          const failedCrawl = buildEmptyWebsiteIntelligenceCrawl(inputUrl, message);
          const persisted = await persistCrawlAndIntelligence({
            client,
            bundle,
            jobId,
            sourceIngestionRunId,
            crawl: failedCrawl,
            elapsedMs,
            openRouterApiKey,
            crawlError: message,
          });
          crawlId = persisted.crawlId;
          intelligenceId = persisted.intelligenceId;
        } catch (persistError) {
          logEvent('website-intelligence-persist-failed', {
            jobId,
            companyId: bundle.company_id,
            error: persistError instanceof Error ? trimPageFailureMessage(persistError.message) : String(persistError),
          });
        }
        logEvent('company-result', {
          jobId,
          companyId: bundle.company_id,
          batch_index: batchIndex,
          batch_total: batchTotal,
          company: bundleLogView(bundle, inputUrl),
          result: {
            band: 'error',
            error: trimPageFailureMessage(message),
          },
          website_crawl_id: crawlId,
          website_intelligence_id: intelligenceId,
        });
        await (client.from('company_website_verifications') as any).upsert({
          company_id: bundle.company_id,
          foundry_job_id: jobId,
          website_crawl_id: crawlId,
          source_ingestion_run_id: sourceIngestionRunId,
          input_url: inputUrl,
          final_url: null,
          score: null,
          band: null,
          signals: { pages: [], worker_error: message },
          error: message,
          verifier_version: WEBSITE_VERIFIER_VERSION,
          crawl_stats: { pages_visited: 0, max_depth_reached: 0, failed_urls: [inputUrl] },
          elapsed_ms: elapsedMs,
          cost_status: 'failed_or_not_costed',
          verified_at: new Date().toISOString(),
        }, { onConflict: 'foundry_job_id,company_id', ignoreDuplicates: false });
        const refreshed = await refreshWebsiteVerificationProgress(client, jobId, payload, progress, 'running');
        Object.assign(progress, refreshed);
      } finally {
        await page.close().catch(() => {});
      }
    }
    const refreshed = await refreshWebsiteVerificationProgress(client, jobId, payload, progress, 'running');
    Object.assign(progress, refreshed);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
