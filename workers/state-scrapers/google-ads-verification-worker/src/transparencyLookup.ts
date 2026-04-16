import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  normalizeGoogleAdsSearchDomain,
  type GoogleAdsVerificationResult,
} from '@furnace/registry-server';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, unknown>;

const SEARCH_INPUT_NAME = /find the ads you've seen by searching by advertiser name or website/i;
const SEARCH_SUGGESTIONS_RE = /\/anji\/_\/rpc\/SearchService\/SearchSuggestions/i;
const ADVERTISER_ID_RE = /\bAR[A-Z0-9]{8,}\b/g;
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 8_000;
const VIEWPORT = { width: 1440, height: 960 };

export interface GoogleAdsTransparencyLookupOptions {
  domain: string;
  region?: string;
  headless?: boolean;
  slowMoMs?: number;
  channel?: 'chrome';
  timeoutMs?: number;
  outputDir?: string | null;
  browser?: Browser;
  context?: BrowserContext;
}

export interface GoogleAdsTransparencyLookupResult {
  result: GoogleAdsVerificationResult;
  search_domain: string;
  input_domain: string;
  matched_advertiser_id: string | null;
  matched_advertiser_name: string | null;
  advertiser_url: string | null;
  latest_ad_last_shown_at: string | null;
  signals: JsonObject;
  lookup_stats: JsonObject;
  error?: string | null;
}

interface DomainSuggestion {
  domain: string;
  raw_path: string;
}

function trimText(value: string | null | undefined, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function decodeGoogleRpcPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.startsWith(")]}'") ? trimmed.replace(/^\)\]\}'\s*/, '') : trimmed;
  const candidates = [withoutPrefix, ...withoutPrefix.split('\n').map((line) => line.trim()).filter(Boolean)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  return withoutPrefix;
}

function collectStrings(node: unknown, limit = 64, out: string[] = []): string[] {
  if (out.length >= limit || node == null) return out;
  if (typeof node === 'string') {
    const parsed = parseMaybeJson(node);
    if (parsed !== node) return collectStrings(parsed, limit, out);
    const trimmed = node.trim();
    if (trimmed) out.push(trimmed);
    return out;
  }
  if (Array.isArray(node)) {
    for (const value of node) {
      collectStrings(value, limit, out);
      if (out.length >= limit) break;
    }
    return out;
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectStrings(value, limit, out);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function collectDomainSuggestions(
  node: unknown,
  path = '$',
  out: DomainSuggestion[] = [],
): DomainSuggestion[] {
  if (typeof node === 'string') {
    const parsed = parseMaybeJson(node);
    if (parsed !== node) return collectDomainSuggestions(parsed, path, out);
    const trimmed = node.trim().toLowerCase();
    if (DOMAIN_RE.test(trimmed)) {
      out.push({ domain: trimmed, raw_path: path });
    }
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectDomainSuggestions(child, `${path}[${index}]`, out));
    return out;
  }
  if (isJsonObject(node)) {
    Object.entries(node).forEach(([key, value]) => collectDomainSuggestions(value, `${path}.${key}`, out));
  }
  return out;
}

function dedupeDomainSuggestions(candidates: DomainSuggestion[]): DomainSuggestion[] {
  const seen = new Set<string>();
  const out: DomainSuggestion[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.domain)) continue;
    seen.add(candidate.domain);
    out.push(candidate);
  }
  return out;
}

function extractAdvertiserIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(ADVERTISER_ID_RE);
  return match?.[0] ?? null;
}

function dedupeHrefs(hrefs: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const href of hrefs) {
    if (typeof href !== 'string' || href.length === 0 || seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

function parseLastShownDateLabel(bodyText: string): string | null {
  const match = bodyText.match(/Last shown:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
  return match?.[1] ?? null;
}

function normalizeLastShownDate(bodyText: string): string | null {
  const label = parseLastShownDateLabel(bodyText);
  if (!label) return null;
  const timestamp = Date.parse(`${label} UTC`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseAdvertiserNameFromBody(bodyText: string): string | null {
  const lines = bodyText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const legalNameLine = lines.find((line) => /^Legal name:/i.test(line));
  if (legalNameLine) {
    return trimText(legalNameLine.replace(/^Legal name:\s*/i, ''), 120);
  }
  const homeIndex = lines.findIndex((line) => line === 'Home');
  if (homeIndex >= 0 && lines[homeIndex + 2]) {
    return trimText(lines[homeIndex + 2], 120);
  }
  return null;
}

async function ensureDirIfNeeded(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const resolved = resolve(path);
  await mkdir(resolved, { recursive: true });
  return resolved;
}

async function maybeSaveScreenshot(page: Page, outputDir: string | null, fileName: string): Promise<string | null> {
  const dir = await ensureDirIfNeeded(outputDir);
  if (!dir) return null;
  const fullPath = resolve(dir, fileName);
  await mkdir(dirname(fullPath), { recursive: true });
  await page.screenshot({ path: fullPath, fullPage: true });
  return fullPath;
}

async function openSearchPage(page: Page, region: string): Promise<string> {
  const url = `https://adstransparency.google.com/?region=${encodeURIComponent(region)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
  return url;
}

async function locateSearchInput(page: Page) {
  const input = page.getByRole('textbox', { name: SEARCH_INPUT_NAME }).first();
  await input.waitFor({ state: 'visible', timeout: NAV_TIMEOUT_MS });
  return input;
}

async function fetchSuggestions(page: Page, searchDomain: string, timeoutMs: number): Promise<{
  parsedBody: unknown;
  rawBody: string;
}> {
  const input = await locateSearchInput(page);
  await input.click({ timeout: NAV_TIMEOUT_MS });
  await input.fill('');
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && SEARCH_SUGGESTIONS_RE.test(response.url()),
    { timeout: timeoutMs },
  );
  await input.type(searchDomain, { delay: 110 });
  const response = await responsePromise;
  const rawBody = await response.text();
  return {
    rawBody,
    parsedBody: decodeGoogleRpcPayload(rawBody),
  };
}

async function clickExactDomainSuggestion(page: Page, searchDomain: string): Promise<void> {
  await page.getByText(searchDomain, { exact: true }).last().click({ timeout: NAV_TIMEOUT_MS });
  await page.waitForURL(
    (url) => url.searchParams.get('domain')?.toLowerCase() === searchDomain.toLowerCase(),
    { timeout: NAV_TIMEOUT_MS },
  );
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
}

async function captureResultsPageSummary(page: Page): Promise<JsonObject> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const adCount = bodyText.match(/(?:~|-)?\d[\d.,KM]*\s+ads/i)?.[0] ?? null;
  const advertiserNames = bodyText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== 'Verified' && !/^arrow_/.test(line))
    .filter((line) => !/^(\d|~|-).*ads$/i.test(line))
    .filter((line) => !['Ads Transparency Center', 'Sign in', 'FAQ', 'All topics', 'Political ads'].includes(line))
    .slice(0, 20);
  return {
    page_title: trimText(await page.title().catch(() => ''), 120),
    body_snippet: trimText(bodyText, 360),
    ad_count_label: adCount,
    advertiser_name_samples: advertiserNames,
  };
}

async function captureAdvertiserPageSummary(page: Page): Promise<{ advertiser_name: string | null; summary: JsonObject }> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const title = trimText(await page.title().catch(() => ''), 120);
  const advertiserName = parseAdvertiserNameFromBody(bodyText);
  return {
    advertiser_name: advertiserName,
    summary: {
      page_title: title,
      body_snippet: trimText(bodyText, 360),
    },
  };
}

async function expandResultsToFullCreativeList(page: Page): Promise<boolean> {
  const seeAllButton = page.getByRole('button', { name: /see all ads/i }).first();
  if (!(await seeAllButton.isVisible().catch(() => false))) return false;
  const clicked = await seeAllButton.click({ timeout: NAV_TIMEOUT_MS }).then(() => true).catch(() => false);
  if (!clicked) return false;
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
  return true;
}

async function collectCreativeHrefs(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a[href*="/creative/"]').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('href'))
      .filter((href): href is string => typeof href === 'string' && href.length > 0),
  );
  return dedupeHrefs(hrefs);
}

async function captureTopCreativeLastShown(
  page: Page,
  creativeHref: string | null,
  region: string,
): Promise<{
  latestAdLastShownAt: string | null;
  creativeDetailUrl: string | null;
  creativeSummary: JsonObject | null;
}> {
  if (!creativeHref) {
    return {
      latestAdLastShownAt: null,
      creativeDetailUrl: null,
      creativeSummary: null,
    };
  }
  const creativeUrl = creativeHref.startsWith('http')
    ? creativeHref
    : `https://adstransparency.google.com${creativeHref}`;
  try {
    await page.goto(creativeUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const lastShownLabel = parseLastShownDateLabel(bodyText);
    return {
      latestAdLastShownAt: normalizeLastShownDate(bodyText),
      creativeDetailUrl: creativeUrl,
      creativeSummary: {
        page_title: trimText(await page.title().catch(() => ''), 120),
        body_snippet: trimText(bodyText, 360),
        last_shown_label: lastShownLabel,
        region,
      },
    };
  } catch (error) {
    return {
      latestAdLastShownAt: null,
      creativeDetailUrl: creativeUrl,
      creativeSummary: {
        error: error instanceof Error ? error.message : String(error),
        region,
      },
    };
  }
}

export async function runGoogleAdsTransparencyLookup(
  options: GoogleAdsTransparencyLookupOptions,
): Promise<GoogleAdsTransparencyLookupResult> {
  const searchDomain = normalizeGoogleAdsSearchDomain(options.domain);
  if (!searchDomain) {
    throw new Error(`Invalid domain input: ${options.domain}`);
  }

  const region = options.region?.trim() || 'US';
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || 15_000);
  const slowMoMs = Math.max(0, Number(options.slowMoMs) || 0);
  const createdBrowser = !options.browser;
  const browser =
    options.browser ??
    (await chromium.launch({
      headless: options.headless ?? false,
      channel: options.channel ?? 'chrome',
      slowMo: slowMoMs || undefined,
      args: ['--disable-blink-features=AutomationControlled'],
    }));
  const createdContext = !options.context;
  const context =
    options.context ??
    (await browser.newContext({
      viewport: VIEWPORT,
      ignoreHTTPSErrors: true,
    }));
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const homeUrl = await openSearchPage(page, region);
    const homeScreenshot = await maybeSaveScreenshot(page, options.outputDir ?? null, `home-${searchDomain}.png`);
    const { parsedBody, rawBody } = await fetchSuggestions(page, searchDomain, timeoutMs);
    const domainSuggestions = dedupeDomainSuggestions(collectDomainSuggestions(parsedBody));
    const exactSuggestion = domainSuggestions.find((candidate) => candidate.domain === searchDomain) ?? null;
    if (!exactSuggestion) {
      const noResultScreenshot = await maybeSaveScreenshot(page, options.outputDir ?? null, `search-${searchDomain}.png`);
      return {
        result: 'no',
        input_domain: options.domain,
        search_domain: searchDomain,
        matched_advertiser_id: null,
        matched_advertiser_name: null,
        advertiser_url: null,
        latest_ad_last_shown_at: null,
        signals: {
          exact_suggestion_found: false,
          suggestion_domains: domainSuggestions.slice(0, 10).map((candidate) => candidate.domain),
          search_box_value: await locateSearchInput(page).then((input) => input.inputValue()).catch(() => searchDomain),
          raw_body_preview: trimText(rawBody, 320),
        },
        lookup_stats: {
          home_url: homeUrl,
          elapsed_ms: Date.now() - startedAt,
          suggestion_candidate_count: domainSuggestions.length,
          home_screenshot: homeScreenshot,
          search_screenshot: noResultScreenshot,
        },
      };
    }

    await clickExactDomainSuggestion(page, searchDomain);
    const resultsScreenshot = await maybeSaveScreenshot(page, options.outputDir ?? null, `results-${searchDomain}.png`);
    const resultsSummary = await captureResultsPageSummary(page);
    const expandedResults = await expandResultsToFullCreativeList(page);
    const creativeHrefs = await collectCreativeHrefs(page);
    const firstCreativeHref = creativeHrefs[0] ?? null;
    const firstAdvertiserId = extractAdvertiserIdFromHref(firstCreativeHref);
    const advertiserUrl = firstAdvertiserId
      ? `https://adstransparency.google.com/advertiser/${firstAdvertiserId}?region=${encodeURIComponent(region)}`
      : null;
    const topCreative = await captureTopCreativeLastShown(page, firstCreativeHref, region);

    let matchedAdvertiserName: string | null = null;
    let advertiserPageSummary: JsonObject | null = null;
    let advertiserScreenshot: string | null = null;
    if (advertiserUrl) {
      await page.goto(advertiserUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
      const advertiserPage = await captureAdvertiserPageSummary(page);
      matchedAdvertiserName = advertiserPage.advertiser_name;
      advertiserPageSummary = advertiserPage.summary;
      advertiserScreenshot = await maybeSaveScreenshot(
        page,
        options.outputDir ?? null,
        `advertiser-${firstAdvertiserId}.png`,
      );
    }

    return {
      result: creativeHrefs.length > 0 ? 'yes' : 'no',
      input_domain: options.domain,
      search_domain: searchDomain,
      matched_advertiser_id: firstAdvertiserId,
      matched_advertiser_name: matchedAdvertiserName,
      advertiser_url: advertiserUrl,
      latest_ad_last_shown_at: topCreative.latestAdLastShownAt,
      signals: {
        exact_suggestion_found: true,
        suggestion_path: exactSuggestion.raw_path,
        suggestion_domains: domainSuggestions.slice(0, 10).map((candidate) => candidate.domain),
        raw_body_preview: trimText(rawBody, 320),
        results_page: resultsSummary,
        top_creative: topCreative.creativeSummary,
        advertiser_page: advertiserPageSummary,
      },
      lookup_stats: {
        home_url: homeUrl,
        results_url: `https://adstransparency.google.com/?region=${encodeURIComponent(region)}&domain=${encodeURIComponent(searchDomain)}`,
        expanded_results: expandedResults,
        elapsed_ms: Date.now() - startedAt,
        suggestion_candidate_count: domainSuggestions.length,
        creative_link_count: creativeHrefs.length,
        creative_link_samples: creativeHrefs.slice(0, 5),
        top_creative_detail_url: topCreative.creativeDetailUrl,
        home_screenshot: homeScreenshot,
        results_screenshot: resultsScreenshot,
        advertiser_screenshot: advertiserScreenshot,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorScreenshot = await maybeSaveScreenshot(page, options.outputDir ?? null, `error-${searchDomain}.png`).catch(
      () => null,
    );
    return {
      result: 'unknown',
      input_domain: options.domain,
      search_domain: searchDomain,
      matched_advertiser_id: null,
      matched_advertiser_name: null,
      advertiser_url: null,
      latest_ad_last_shown_at: null,
      error: message,
      signals: {
        search_domain: searchDomain,
      },
      lookup_stats: {
        elapsed_ms: Date.now() - startedAt,
        final_url: page.url(),
        error_screenshot: errorScreenshot,
      },
    };
  } finally {
    await page.close().catch(() => {});
    if (createdContext) await context.close().catch(() => {});
    if (createdBrowser) await browser.close().catch(() => {});
  }
}
