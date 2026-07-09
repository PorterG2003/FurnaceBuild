import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { normalizeGoogleAdsSearchDomain } from '@furnace/registry-server';
import {
  buildMetaAdLibrarySearchUrl,
  pickSearchTypeForTerm,
  type MetaAdLibrarySearchType,
} from './metaAdLibraryUrl.js';
import {
  classifyMetaAdResults,
  isInconclusiveClassification,
  latestAdStartedRunningFromCards,
  parseMetaAdLibraryBodyText,
  pickMatchedAdsForSignals,
  type MetaAdLibraryPageSnapshot,
  type MetaAdsVerificationResult,
} from './metaAdLibraryParse.js';

const NAV_TIMEOUT_MS = 45_000;
const SETTLE_TIMEOUT_MS = 15_000;
const VIEWPORT = { width: 1440, height: 960 };

export interface MetaAdLibraryLookupOptions {
  domain: string;
  companyName?: string | null;
  country?: string;
  headless?: boolean;
  slowMoMs?: number;
  channel?: 'chrome';
  timeoutMs?: number;
  outputDir?: string | null;
  browser?: Browser;
  context?: BrowserContext;
  signal?: AbortSignal;
}

export interface MetaAdLibraryLookupResult {
  result: MetaAdsVerificationResult;
  search_domain: string;
  input_domain: string;
  search_term_used: string | null;
  fallback_search_term: string | null;
  matched_page_id: string | null;
  matched_page_name: string | null;
  page_url: string | null;
  latest_ad_last_shown_at: string | null;
  signals: Record<string, unknown>;
  lookup_stats: Record<string, unknown>;
  error?: string | null;
}

interface SearchAttemptRecord {
  search_term: string;
  search_type: MetaAdLibrarySearchType;
  search_url: string;
  result: MetaAdsVerificationResult;
  matched_via: string | null;
  reason: string | null;
  result_card_count: number;
  blocker: string | null;
  screenshot: string | null;
}

function trimText(value: string | null | undefined, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
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
  await page.screenshot({ path: fullPath, fullPage: true }).catch(() => undefined);
  return fullPath;
}

async function dismissCookieConsent(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /allow all cookies|accept all|allow essential/i }).first(),
    page.getByRole('button', { name: /^accept$/i }).first(),
    page.locator('[data-testid="cookie-policy-manage-dialog-accept-button"]').first(),
  ];
  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function extractPageSnapshot(page: Page, searchDomain: string | null = null): Promise<MetaAdLibraryPageSnapshot> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const pageTitle = await page.title().catch(() => '');
  const parsed = parseMetaAdLibraryBodyText(bodyText, searchDomain);
  return {
    ...parsed,
    page_title: pageTitle || parsed.page_title,
  };
}

async function waitForResultsHydration(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await extractPageSnapshot(page);
    if (snapshot.blocker) return;
    if (snapshot.no_results) return;
    if (snapshot.cards.length > 0) return;
    const body = snapshot.body_text.toLowerCase();
    if (body.includes('library id:')) return;
    if (/\d[\d,]*\+?\s+results/i.test(snapshot.body_text)) return;
    await page.waitForTimeout(400);
  }
}

async function runSingleSearch(
  page: Page,
  args: {
    searchTerm: string;
    searchType: MetaAdLibrarySearchType;
    country: string;
    searchDomain: string;
    companyName?: string | null;
    outputDir: string | null;
    screenshotPrefix: string;
  },
): Promise<{ classification: ReturnType<typeof classifyMetaAdResults>; snapshot: MetaAdLibraryPageSnapshot; searchUrl: string; screenshot: string | null }> {
  const searchUrl = buildMetaAdLibrarySearchUrl({
    q: args.searchTerm,
    country: args.country,
    searchType: args.searchType,
  });
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await dismissCookieConsent(page);
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
  await waitForResultsHydration(page, SETTLE_TIMEOUT_MS);
  const snapshot = await extractPageSnapshot(page, args.searchDomain);
  const screenshot = await maybeSaveScreenshot(page, args.outputDir, `${args.screenshotPrefix}.png`);
  const classification = classifyMetaAdResults({
    searchDomain: args.searchDomain,
    companyName: args.companyName,
    snapshot,
  });
  return { classification, snapshot, searchUrl, screenshot };
}

function buildEmptyResult(
  options: MetaAdLibraryLookupOptions,
  searchDomain: string,
  attempts: SearchAttemptRecord[],
  startedAt: number,
): MetaAdLibraryLookupResult {
  const primary = attempts[0] ?? null;
  const fallback = attempts[1] ?? null;
  return {
    result: 'unknown',
    search_domain: searchDomain,
    input_domain: options.domain,
    search_term_used: primary?.search_term ?? null,
    fallback_search_term: fallback?.search_term ?? null,
    matched_page_id: null,
    matched_page_name: null,
    page_url: null,
    latest_ad_last_shown_at: null,
    signals: {
      search_attempts: attempts,
      result_card_count: attempts[attempts.length - 1]?.result_card_count ?? 0,
      matched_via: null,
      raw_page_title: null,
      blocker: attempts.find((a) => a.blocker)?.blocker ?? null,
      matched_ads: [],
      top_ad: null,
      matched_ad_count: 0,
    },
    lookup_stats: {
      search_url: primary?.search_url ?? null,
      fallback_search_url: fallback?.search_url ?? null,
      elapsed_ms: Date.now() - startedAt,
      final_url: null,
      attempt_count: attempts.length,
    },
  };
}

function enrichResult(
  base: MetaAdLibraryLookupResult,
  winningClassification: ReturnType<typeof classifyMetaAdResults>,
  snapshot: MetaAdLibraryPageSnapshot,
  page: Page,
  startedAt: number,
  attempts: SearchAttemptRecord[],
  companyName?: string | null,
): MetaAdLibraryLookupResult {
  const matched = winningClassification.matched_card;
  const matchedAds = pickMatchedAdsForSignals(
    snapshot,
    base.search_domain,
    winningClassification,
    companyName,
  );
  return {
    ...base,
    result: winningClassification.result,
    matched_page_id: matched?.page_id ?? null,
    matched_page_name: matched?.page_name ?? null,
    page_url: matched?.page_url ?? null,
    latest_ad_last_shown_at: latestAdStartedRunningFromCards(snapshot.cards),
    signals: {
      ...base.signals,
      search_attempts: attempts,
      result_card_count: snapshot.cards.length,
      matched_via: winningClassification.matched_via,
      raw_page_title: trimText(snapshot.page_title, 120),
      classification_reason: winningClassification.reason,
      ambiguous: winningClassification.ambiguous,
      matched_ads: matchedAds,
      top_ad: matchedAds[0] ?? null,
      matched_ad_count: matchedAds.length,
    },
    lookup_stats: {
      ...base.lookup_stats,
      elapsed_ms: Date.now() - startedAt,
      final_url: page.url(),
    },
  };
}

export async function runMetaAdLibraryLookup(
  options: MetaAdLibraryLookupOptions,
): Promise<MetaAdLibraryLookupResult> {
  const searchDomain = normalizeGoogleAdsSearchDomain(options.domain);
  if (!searchDomain) {
    return {
      result: 'unknown',
      search_domain: '',
      input_domain: options.domain,
      search_term_used: null,
      fallback_search_term: null,
      matched_page_id: null,
      matched_page_name: null,
      page_url: null,
      latest_ad_last_shown_at: null,
      error: 'Invalid domain',
      signals: {
        matched_ads: [],
        top_ad: null,
        matched_ad_count: 0,
      },
      lookup_stats: {},
    };
  }

  const country = options.country ?? 'US';
  const headless = options.headless ?? false;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const slowMoMs = options.slowMoMs ?? 0;
  const outputDir = options.outputDir ?? null;
  const startedAt = Date.now();

  let createdBrowser = false;
  let createdContext = false;
  const browser =
    options.browser ??
    (await chromium.launch({
      headless,
      channel: options.channel ?? 'chrome',
      slowMo: slowMoMs || undefined,
      args: ['--disable-blink-features=AutomationControlled'],
    }));
  createdBrowser = !options.browser;

  const context =
    options.context ??
    (await browser.newContext({
      viewport: VIEWPORT,
      ignoreHTTPSErrors: true,
    }));
  createdContext = !options.context;

  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  const attempts: SearchAttemptRecord[] = [];

  try {
    const domainSearchType = pickSearchTypeForTerm(searchDomain);
    const domainAttempt = await runSingleSearch(page, {
      searchTerm: searchDomain,
      searchType: domainSearchType,
      country,
      searchDomain,
      companyName: options.companyName,
      outputDir,
      screenshotPrefix: `domain-${searchDomain}`,
    });

    attempts.push({
      search_term: searchDomain,
      search_type: domainSearchType,
      search_url: domainAttempt.searchUrl,
      result: domainAttempt.classification.result,
      matched_via: domainAttempt.classification.matched_via,
      reason: domainAttempt.classification.reason,
      result_card_count: domainAttempt.snapshot.cards.length,
      blocker: domainAttempt.snapshot.blocker,
      screenshot: domainAttempt.screenshot,
    });

    let winningClassification = domainAttempt.classification;
    let winningSnapshot = domainAttempt.snapshot;

    const companyName = options.companyName?.trim() ?? '';
    if (companyName && isInconclusiveClassification(domainAttempt.classification)) {
      const nameSearchType = pickSearchTypeForTerm(companyName);
      const nameAttempt = await runSingleSearch(page, {
        searchTerm: companyName,
        searchType: nameSearchType,
        country,
        searchDomain,
        companyName,
        outputDir,
        screenshotPrefix: `name-${searchDomain.replace(/\./g, '-')}`,
      });
      attempts.push({
        search_term: companyName,
        search_type: nameSearchType,
        search_url: nameAttempt.searchUrl,
        result: nameAttempt.classification.result,
        matched_via: nameAttempt.classification.matched_via,
        reason: nameAttempt.classification.reason,
        result_card_count: nameAttempt.snapshot.cards.length,
        blocker: nameAttempt.snapshot.blocker,
        screenshot: nameAttempt.screenshot,
      });
      if (
        nameAttempt.classification.result === 'yes' ||
        (nameAttempt.classification.result === 'no' && domainAttempt.classification.result === 'unknown')
      ) {
        winningClassification = nameAttempt.classification;
        winningSnapshot = nameAttempt.snapshot;
      }
    }

    const base = buildEmptyResult(options, searchDomain, attempts, startedAt);
    return enrichResult(
      base,
      winningClassification,
      winningSnapshot,
      page,
      startedAt,
      attempts,
      options.companyName,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorScreenshot = await maybeSaveScreenshot(page, outputDir, `error-${searchDomain}.png`).catch(() => null);
    return {
      result: 'unknown',
      search_domain: searchDomain,
      input_domain: options.domain,
      search_term_used: searchDomain,
      fallback_search_term: options.companyName?.trim() ?? null,
      matched_page_id: null,
      matched_page_name: null,
      page_url: null,
      latest_ad_last_shown_at: null,
      error: message,
      signals: {
        search_attempts: attempts,
        search_domain: searchDomain,
        matched_ads: [],
        top_ad: null,
        matched_ad_count: 0,
      },
      lookup_stats: {
        elapsed_ms: Date.now() - startedAt,
        final_url: page.url(),
        error_screenshot: errorScreenshot,
      },
    };
  } finally {
    await page.close().catch(() => undefined);
    if (createdContext) await context.close().catch(() => undefined);
    if (createdBrowser) await browser.close().catch(() => undefined);
  }
}
