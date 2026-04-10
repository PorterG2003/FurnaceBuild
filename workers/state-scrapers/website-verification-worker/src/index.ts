import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import { chromium, type Browser, type Page } from 'playwright';
import {
  WEBSITE_VERIFIER_VERSION,
  canonicalizeWebsiteUrl,
  countWebsiteVerificationBands,
  loadWebsiteVerificationBundles,
  normalizeComparableText,
  pickWebsiteVerificationTarget,
  scoreWebsiteVerification,
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
  same_origin_links: Array<{ href: string; text: string }>;
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
const VIEWPORT = { width: 1280, height: 720 };

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

function registrableDomainKeyFromUrl(raw: string | null | undefined): string | null {
  const url = canonicalizeWebsiteUrl(raw);
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

function normalizeCrawlUrl(raw: string): string | null {
  const canonical = canonicalizeWebsiteUrl(raw);
  if (!canonical) return null;
  try {
    const url = new URL(canonical);
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
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
  if (!path || path === '/' || path === '/home') return 'home';
  if (/(contact|contact us|get in touch|request a quote)/.test(haystack)) return 'contact';
  if (/(about|our story|who we are|company)/.test(haystack)) return 'about';
  if (/(team|staff|leadership|crew|meet the)/.test(haystack)) return 'team';
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
): Promise<WebsiteVerificationCrawlResult> {
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
      finalUrl = extracted.final_url || finalUrl;
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

async function loadSecret(): Promise<{ url: string; key: string; jobId: string }> {
  const url = process.env.LEADS_SUPABASE_URL?.trim();
  const jobId = process.env.JOB_ID?.trim();
  let key = process.env.LEADS_SUPABASE_SECRET_KEY?.trim();
  const paramPath = process.env.LEADS_SUPABASE_SECRET_KEY_PARAM_PATH?.trim();
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
  return { url, key, jobId };
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

async function main(): Promise<void> {
  const { url, key, jobId } = await loadSecret();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: jobRow, error: jobErr } = await client
    .from('foundry_jobs')
    .select('payload, progress')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr || !jobRow) {
    throw new Error(jobErr?.message || `Job ${jobId} not found`);
  }
  const payload = (jobRow.payload ?? {}) as Record<string, unknown>;
  const progress = ((jobRow.progress ?? {}) as JobProgress) || {};
  const envCompanyIds = process.env.COMPANY_IDS_JSON?.trim();
  const companyIds = (() => {
    if (envCompanyIds) {
      try {
        const parsed = JSON.parse(envCompanyIds);
        if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
      } catch {
        // fall through to payload
      }
    }
    return Array.isArray(payload.company_ids)
      ? payload.company_ids.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
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

  logEvent('worker-start', { jobId, companies: companyIds.length, sourceIngestionRunId });
  const bundles = await loadWebsiteVerificationBundles(
    client as unknown as Parameters<typeof loadWebsiteVerificationBundles>[0],
    companyIds,
  );
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  try {
    for (const bundle of bundles) {
      const inputUrl = pickWebsiteVerificationTarget(bundle);
      logEvent('company-start', {
        jobId,
        companyId: bundle.company_id,
        company: bundleLogView(bundle, inputUrl),
      });
      if (!inputUrl) {
        logEvent('company-skipped', {
          jobId,
          companyId: bundle.company_id,
          reason: 'missing_input_url',
          company: bundleLogView(bundle, inputUrl),
        });
        progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
        progress.outcome_skipped = Number(progress.outcome_skipped ?? 0) + 1;
        await updateJobProgress(client, jobId, progress);
        continue;
      }
      const page = await context.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);
      try {
        const crawl = await crawlWebsite(page, bundle, inputUrl);
        const scored = scoreWebsiteVerification(bundle, crawl);
        logEvent('company-result', {
          jobId,
          companyId: bundle.company_id,
          company: bundleLogView(bundle, inputUrl),
          crawl: crawlLogView(crawl),
          result: scoreLogView(scored),
        });
        const { error } = await (client.from('company_website_verifications') as any).insert({
          company_id: bundle.company_id,
          foundry_job_id: jobId,
          source_ingestion_run_id: sourceIngestionRunId,
          input_url: crawl.input_url,
          final_url: crawl.final_url,
          score: scored.score,
          band: scored.band,
          signals: scored.signals,
          verifier_version: WEBSITE_VERIFIER_VERSION,
          crawl_stats: scored.crawl_stats,
          verified_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
        progress.companies_with_result = Number(progress.companies_with_result ?? 0) + 1;
        if (scored.band === 'usable') progress.outcome_usable = Number(progress.outcome_usable ?? 0) + 1;
        if (scored.band === 'uncertain') progress.outcome_uncertain = Number(progress.outcome_uncertain ?? 0) + 1;
        if (scored.band === 'not_usable') progress.outcome_not_usable = Number(progress.outcome_not_usable ?? 0) + 1;
        await updateJobProgress(client, jobId, progress);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logEvent('company-result', {
          jobId,
          companyId: bundle.company_id,
          company: bundleLogView(bundle, inputUrl),
          result: {
            band: 'error',
            error: trimPageFailureMessage(message),
          },
        });
        await (client.from('company_website_verifications') as any).insert({
          company_id: bundle.company_id,
          foundry_job_id: jobId,
          source_ingestion_run_id: sourceIngestionRunId,
          input_url: inputUrl,
          final_url: null,
          score: null,
          band: null,
          signals: { pages: [], worker_error: message },
          error: message,
          verifier_version: WEBSITE_VERIFIER_VERSION,
          crawl_stats: { pages_visited: 0, max_depth_reached: 0, failed_urls: [inputUrl] },
          verified_at: new Date().toISOString(),
        });
        progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
        progress.companies_with_result = Number(progress.companies_with_result ?? 0) + 1;
        progress.outcome_error = Number(progress.outcome_error ?? 0) + 1;
        await updateJobProgress(client, jobId, progress);
      } finally {
        await page.close().catch(() => {});
      }
    }

    const { data: rows, error: rowsErr } = await (client
      .from('company_website_verifications') as any)
      .select('band, error')
      .eq('foundry_job_id', jobId);
    if (rowsErr) throw new Error(rowsErr.message);
    const counts = countWebsiteVerificationBands((rows ?? []) as Array<{ band: string | null; error?: string | null }>);
    await updateJobProgress(client, jobId, {
      ...progress,
      outcome_usable: counts.usable,
      outcome_uncertain: counts.uncertain,
      outcome_not_usable: counts.not_usable,
      outcome_error: counts.error,
    });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
