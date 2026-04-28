import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebsiteVerificationPageKind } from './websiteVerification.js';

export const WEBSITE_INTELLIGENCE_CRAWL_VERSION = 'foundry_website_intelligence_crawl_v1';
export const WEBSITE_INTELLIGENCE_BRIEF_VERSION = 'foundry_website_intelligence_brief_v1';
export const WEBSITE_INTELLIGENCE_PROMPT_VERSION = 'foundry_website_intelligence_prompt_v1';
export const WEBSITE_INTELLIGENCE_MODEL_PROVIDER = 'openrouter';
export const WEBSITE_INTELLIGENCE_DEFAULT_MODEL = 'google/gemini-2.0-flash-lite-001';
export const WEBSITE_INTELLIGENCE_MAX_PAGE_TEXT_CHARS = 8_000;
export const WEBSITE_INTELLIGENCE_MAX_TOTAL_TEXT_CHARS = 80_000;
export const WEBSITE_INTELLIGENCE_MAX_BRIEF_CHARS = 12_000;
export const WEBSITE_INTELLIGENCE_MAX_TOP_PAGES = 8;
const WEBSITE_INTELLIGENCE_BRIEF_TEXT_BUDGET = 8_500;

export type WebsiteIntelligencePageKind = WebsiteVerificationPageKind | 'services';

export interface WebsiteCrawlPage {
  url: string;
  final_url: string;
  depth: number;
  page_kind: WebsiteIntelligencePageKind;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  headings: string[];
  main_text: string;
  visible_text?: string;
  text_char_count: number;
  links: Array<{ href: string; text: string }>;
  images: Array<{ src: string; alt: string | null; width?: number; height?: number }>;
  json_ld: unknown[];
  phones: string[];
  emails: string[];
  social_links: string[];
  canonical_url: string | null;
  parse_ok: boolean;
  error?: string | null;
}

export interface WebsiteSiteAssets {
  logo_candidates: Array<{ url: string; source: 'img' | 'json_ld' | 'og' | 'favicon'; confidence: number }>;
  hero_image_candidates: string[];
  favicon_urls: string[];
  theme_color: string | null;
  brand_color_candidates: Array<{
    color: string;
    source: 'meta' | 'css' | 'logo' | 'dominant_page';
    count?: number;
  }>;
  organization_names: string[];
  social_profiles: string[];
  contact: { phones: string[]; emails: string[]; addresses: string[] };
}

export interface WebsiteIntelligenceCrawlResult {
  input_url: string;
  final_url: string | null;
  normalized_domain_key: string | null;
  pages: WebsiteCrawlPage[];
  failed_urls: string[];
  pages_visited: number;
  max_depth_reached: number;
  parked: boolean;
  site_assets: WebsiteSiteAssets;
}

export interface WebsiteSiteBrief {
  url: string;
  final_url: string | null;
  page_count: number;
  top_pages: Array<{
    url: string;
    page_kind: string;
    title: string | null;
    h1: string | null;
    headings: string[];
    snippet: string;
  }>;
  organization_names: string[];
  services_terms: string[];
  location_terms: string[];
  contact_evidence: { phones: string[]; emails: string[]; addresses: string[] };
  social_profiles: string[];
  logo_candidates: string[];
  hero_image_candidates: string[];
  color_candidates: string[];
}

export interface WebsiteExtractedProfile {
  business_summary: string | null;
  brand_name: string | null;
  audience_segments: string[];
  services: string[];
  industries_served: string[];
  locations_served: string[];
  tone: string | null;
  confidence: 'low' | 'medium' | 'high';
  evidence_urls: string[];
}

export interface WebsiteIntelligenceValidationReport {
  url: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    pages_visited: number;
    max_depth_reached: number;
    failed_url_count: number;
    main_text_chars: number;
    site_brief_chars: number;
    llm_input_chars: number;
    logo_candidate_count: number;
    color_candidate_count: number;
    organization_name_count: number;
    service_count: number;
    audience_segment_count: number;
    evidence_url_count: number;
  };
  examples: {
    selected_pages: Array<{ url: string; page_kind: string; title: string | null }>;
    logo_candidates: string[];
    hero_image_candidates: string[];
    color_candidates: string[];
    services: string[];
    audience_segments: string[];
    business_summary: string | null;
  };
}

export interface PersistWebsiteCrawlParams {
  companyId: string;
  foundryJobId: string | null;
  sourceIngestionRunId: string | null;
  crawl: WebsiteIntelligenceCrawlResult;
  maxDepth: number;
  maxPages: number;
  elapsedMs: number;
  error?: string | null;
}

export interface PersistWebsiteIntelligenceParams {
  companyId: string;
  websiteCrawlId: string | null;
  foundryJobId: string | null;
  sourceIngestionRunId: string | null;
  inputHash: string;
  siteBrief: WebsiteSiteBrief;
  extractedProfile: WebsiteExtractedProfile | null;
  llmStatus: 'not_run' | 'completed' | 'failed' | 'skipped';
  llmUsage?: Record<string, unknown>;
  error?: string | null;
  modelProvider?: string;
  model?: string;
  generatedAt?: string | null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashWebsiteIntelligenceInput(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function compactText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string | null | undefined, max: number): string {
  const text = compactText(value);
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
}

function uniqStrings(values: Array<string | null | undefined>, max = 40): string[] {
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

function pagePriority(page: WebsiteCrawlPage): number {
  let score = 0;
  if (page.depth === 0) score += 18;
  if (page.page_kind === 'home') score += 26;
  if (page.page_kind === 'services') score += 22;
  if (page.page_kind === 'about') score += 12;
  if (page.page_kind === 'contact' || page.page_kind === 'locations') score += 9;
  if (page.page_kind === 'team') score += 2;
  if (page.page_kind === 'policy' || page.page_kind === 'blog') score -= 8;
  if (page.title) score += 2;
  if (page.h1) score += 2;
  score += Math.min(8, Math.floor(compactText(page.main_text).length / 500));
  score -= page.depth;
  return score;
}

function extractTermsFromText(text: string, patterns: RegExp[], max = 24): string[] {
  const normalized = compactText(text);
  const hits: string[] = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const hit = compactText(match[1] ?? match[0]);
      if (hit && hit.length >= 3 && hit.length <= 80) hits.push(hit);
      if (hits.length >= max * 3) break;
    }
  }
  return uniqStrings(hits, max);
}

export function buildWebsiteSiteBrief(crawl: WebsiteIntelligenceCrawlResult): WebsiteSiteBrief {
  const dedupedPages: WebsiteCrawlPage[] = [];
  const seenPageKeys = new Set<string>();
  for (const page of [...crawl.pages].sort((a, b) => pagePriority(b) - pagePriority(a) || a.depth - b.depth || a.url.localeCompare(b.url))) {
    let key = page.url;
    try {
      const url = new URL(page.url);
      url.search = '';
      url.hash = '';
      key = `${url.origin}${url.pathname}`.replace(/\/+$/, '') || url.origin;
    } catch {
      // keep raw key
    }
    if (seenPageKeys.has(key)) continue;
    seenPageKeys.add(key);
    dedupedPages.push(page);
    if (dedupedPages.length >= WEBSITE_INTELLIGENCE_MAX_TOP_PAGES) break;
  }
  const topPages = dedupedPages
    .sort((a, b) => pagePriority(b) - pagePriority(a) || a.depth - b.depth || a.url.localeCompare(b.url))
    .slice(0, WEBSITE_INTELLIGENCE_MAX_TOP_PAGES);
  let remaining = WEBSITE_INTELLIGENCE_BRIEF_TEXT_BUDGET;
  const briefPages = topPages.map((page) => {
    const headings = uniqStrings(page.headings, 8).map((item) => truncate(item, 100));
    const baseOverhead = compactText([page.url, page.page_kind, page.title, page.h1, headings.join(' ')].join(' ')).length;
    const snippetBudget = Math.max(160, Math.min(900, remaining - baseOverhead));
    const snippet = truncate(page.main_text || page.visible_text, snippetBudget);
    remaining = Math.max(0, remaining - baseOverhead - snippet.length);
    return {
      url: page.url,
      page_kind: page.page_kind,
      title: page.title,
      h1: page.h1,
      headings,
      snippet,
    };
  });
  const allText = crawl.pages
    .slice(0, 12)
    .map((page) => [page.title, page.h1, page.headings.join(' '), page.main_text].join(' '))
    .join(' ');
  const servicesTerms = extractTermsFromText(allText, [
    /\b(?:services?|solutions?|specialties|offerings?)\b[:\-\s]+([^.!?;]{3,80})/gi,
    /\b(?:we offer|we provide|we build|we serve|specializing in)\b\s+([^.!?;]{3,80})/gi,
  ]);
  const locationTerms = extractTermsFromText(allText, [
    /\b(?:serving|located in|based in|service areas?)\b\s+([^.!?;]{3,80})/gi,
  ]);
  return {
    url: crawl.input_url,
    final_url: crawl.final_url,
    page_count: crawl.pages_visited,
    top_pages: briefPages,
    organization_names: uniqStrings(crawl.site_assets.organization_names, 12),
    services_terms: servicesTerms,
    location_terms: locationTerms,
    contact_evidence: {
      phones: uniqStrings(crawl.site_assets.contact.phones, 8),
      emails: uniqStrings(crawl.site_assets.contact.emails, 8),
      addresses: uniqStrings(crawl.site_assets.contact.addresses, 8),
    },
    social_profiles: uniqStrings(crawl.site_assets.social_profiles, 12),
    logo_candidates: uniqStrings(crawl.site_assets.logo_candidates.map((item) => item.url), 8),
    hero_image_candidates: uniqStrings(crawl.site_assets.hero_image_candidates, 5),
    color_candidates: uniqStrings([
      crawl.site_assets.theme_color,
      ...crawl.site_assets.brand_color_candidates.map((item) => item.color),
    ], 12),
  };
}

function asStringArray(value: unknown, max = 16): string[] {
  if (!Array.isArray(value)) return [];
  return uniqStrings(value.map((item) => (typeof item === 'string' ? item : null)), max);
}

function asNullableString(value: unknown, max = 600): string | null {
  return typeof value === 'string' && value.trim() ? truncate(value, max) : null;
}

export function normalizeWebsiteExtractedProfile(value: unknown): WebsiteExtractedProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const rawConfidence = typeof obj.confidence === 'string' ? obj.confidence.toLowerCase() : '';
  const confidence: WebsiteExtractedProfile['confidence'] =
    rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low' ? rawConfidence : 'low';
  return {
    business_summary: asNullableString(obj.business_summary, 800),
    brand_name: asNullableString(obj.brand_name, 120),
    audience_segments: asStringArray(obj.audience_segments, 12),
    services: asStringArray(obj.services, 20),
    industries_served: asStringArray(obj.industries_served, 12),
    locations_served: asStringArray(obj.locations_served, 12),
    tone: asNullableString(obj.tone, 120),
    confidence,
    evidence_urls: asStringArray(obj.evidence_urls, 12),
  };
}

export function buildWebsiteIntelligenceValidationReport(params: {
  crawl: WebsiteIntelligenceCrawlResult;
  siteBrief: WebsiteSiteBrief;
  profile: WebsiteExtractedProfile | null;
  llmInputChars: number;
  persisted?: { crawlId?: string | null; verificationHasCrawlId?: boolean; intelligenceId?: string | null };
}): WebsiteIntelligenceValidationReport {
  const { crawl, siteBrief, profile } = params;
  const errors: string[] = [];
  const warnings: string[] = [];
  const mainTextChars = crawl.pages.reduce((sum, page) => sum + compactText(page.main_text).length, 0);
  const siteBriefChars = JSON.stringify(siteBrief).length;
  const crawledUrls = new Set(crawl.pages.map((page) => page.url));
  if (crawl.pages_visited === 0) errors.push('crawl_succeeded_with_zero_pages');
  const home = crawl.pages.find((page) => page.depth === 0 || page.page_kind === 'home');
  if (home && !home.title && !home.h1 && compactText(home.main_text).length < 80) {
    errors.push('homepage_missing_title_heading_or_meaningful_text');
  }
  if (siteBriefChars > WEBSITE_INTELLIGENCE_MAX_BRIEF_CHARS * 1.25) errors.push('site_brief_exceeds_budget');
  if (params.persisted && !params.persisted.crawlId) errors.push('missing_persisted_crawl_id');
  if (params.persisted?.verificationHasCrawlId === false) errors.push('verification_missing_website_crawl_id');
  if (params.persisted && !params.persisted.intelligenceId) errors.push('missing_persisted_intelligence_id');
  const evidence = profile?.evidence_urls ?? [];
  for (const url of evidence) {
    if (!crawledUrls.has(url)) errors.push(`llm_evidence_url_not_crawled:${url}`);
  }
  if (crawl.site_assets.logo_candidates.length === 0) warnings.push('no_logo_candidates');
  if (!crawl.site_assets.theme_color && crawl.site_assets.brand_color_candidates.length === 0) {
    warnings.push('no_theme_or_brand_colors');
  }
  if (crawl.failed_urls.length > Math.max(3, crawl.pages_visited)) warnings.push('many_failed_urls');
  if (profile && mainTextChars > 1_000 && profile.services.length === 0) warnings.push('empty_services_despite_text');
  if (profile && mainTextChars > 1_000 && profile.audience_segments.length === 0) {
    warnings.push('empty_audience_segments_despite_text');
  }
  if (profile?.confidence === 'high' && evidence.length < 2) warnings.push('high_confidence_with_thin_evidence');
  return {
    url: crawl.input_url,
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      pages_visited: crawl.pages_visited,
      max_depth_reached: crawl.max_depth_reached,
      failed_url_count: crawl.failed_urls.length,
      main_text_chars: mainTextChars,
      site_brief_chars: siteBriefChars,
      llm_input_chars: params.llmInputChars,
      logo_candidate_count: crawl.site_assets.logo_candidates.length,
      color_candidate_count: crawl.site_assets.brand_color_candidates.length + (crawl.site_assets.theme_color ? 1 : 0),
      organization_name_count: crawl.site_assets.organization_names.length,
      service_count: profile?.services.length ?? 0,
      audience_segment_count: profile?.audience_segments.length ?? 0,
      evidence_url_count: evidence.length,
    },
    examples: {
      selected_pages: siteBrief.top_pages.map((page) => ({
        url: page.url,
        page_kind: page.page_kind,
        title: page.title,
      })),
      logo_candidates: crawl.site_assets.logo_candidates.slice(0, 5).map((item) => item.url),
      hero_image_candidates: crawl.site_assets.hero_image_candidates.slice(0, 5),
      color_candidates: [
        crawl.site_assets.theme_color,
        ...crawl.site_assets.brand_color_candidates.map((item) => item.color),
      ].filter((item): item is string => Boolean(item)).slice(0, 8),
      services: profile?.services.slice(0, 8) ?? [],
      audience_segments: profile?.audience_segments.slice(0, 8) ?? [],
      business_summary: profile?.business_summary ?? null,
    },
  };
}

export async function upsertCompanyWebsiteCrawl(
  client: SupabaseClient,
  params: PersistWebsiteCrawlParams,
): Promise<{ id: string }> {
  const { data, error } = await client
    .from('company_website_crawls')
    .upsert(
      {
        company_id: params.companyId,
        foundry_job_id: params.foundryJobId,
        source_ingestion_run_id: params.sourceIngestionRunId,
        input_url: params.crawl.input_url,
        final_url: params.crawl.final_url,
        normalized_domain_key: params.crawl.normalized_domain_key,
        crawl_version: WEBSITE_INTELLIGENCE_CRAWL_VERSION,
        max_depth: params.maxDepth,
        max_pages: params.maxPages,
        pages_visited: params.crawl.pages_visited,
        max_depth_reached: params.crawl.max_depth_reached,
        failed_urls: params.crawl.failed_urls,
        parked: params.crawl.parked,
        pages: params.crawl.pages,
        site_assets: params.crawl.site_assets,
        elapsed_ms: params.elapsedMs,
        error: params.error ?? null,
        crawled_at: new Date().toISOString(),
      },
      { onConflict: 'foundry_job_id,company_id', ignoreDuplicates: false },
    )
    .select('id')
    .single();
  if (error || !data?.id) throw new Error(error?.message ?? 'Failed to upsert website crawl');
  return { id: String(data.id) };
}

export async function upsertCompanyWebsiteIntelligence(
  client: SupabaseClient,
  params: PersistWebsiteIntelligenceParams,
): Promise<{ id: string; costRecordId: string | null }> {
  const modelProvider = params.modelProvider ?? WEBSITE_INTELLIGENCE_MODEL_PROVIDER;
  const model = params.model ?? WEBSITE_INTELLIGENCE_DEFAULT_MODEL;
  const { data, error } = await client
    .from('company_website_intelligence')
    .upsert(
      {
        company_id: params.companyId,
        website_crawl_id: params.websiteCrawlId,
        foundry_job_id: params.foundryJobId,
        source_ingestion_run_id: params.sourceIngestionRunId,
        input_hash: params.inputHash,
        brief_version: WEBSITE_INTELLIGENCE_BRIEF_VERSION,
        prompt_version: WEBSITE_INTELLIGENCE_PROMPT_VERSION,
        model_provider: modelProvider,
        model,
        llm_status: params.llmStatus,
        site_brief: params.siteBrief,
        extracted_profile: params.extractedProfile ?? {},
        llm_usage: params.llmUsage ?? {},
        error: params.error ?? null,
        generated_at: params.generatedAt ?? (params.llmStatus === 'completed' ? new Date().toISOString() : null),
      },
      {
        onConflict: 'website_crawl_id,brief_version,prompt_version,model_provider,model',
        ignoreDuplicates: false,
      },
    )
    .select('id, cost_record_id')
    .single();
  if (error || !data?.id) throw new Error(error?.message ?? 'Failed to upsert website intelligence');
  return {
    id: String(data.id),
    costRecordId: data.cost_record_id == null ? null : String(data.cost_record_id),
  };
}
