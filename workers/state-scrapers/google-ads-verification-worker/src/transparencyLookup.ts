import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import {
  normalizeGoogleAdsSearchDomain,
  type GoogleAdsVerificationResult,
} from '@furnace/registry-server';
import {
  extractCreativeDisplayFromCreativePage,
  pickSamplesForDisplay,
  TRANSPARENCY_CREATIVE_FALLBACK_BODY,
  TRANSPARENCY_CREATIVE_FALLBACK_HEADLINE,
  type TransparencyCreativeSampleRow,
  type TransparencyScannedCreative,
} from './transparencyCreativeDisplay.js';
import { workerJsonLog } from './workerJsonLog.js';

export type { TransparencyCreativeSampleRow } from './transparencyCreativeDisplay.js';

/** Same logic as `lib/flux/fluxCompetitorAuditRank.calendarRunDaysBetween` (kept local so the worker bundle does not rely on that named ESM export). */
function calendarRunDaysBetween(firstIso: string, lastIso: string): number | null {
  const a = Date.parse(`${firstIso}T12:00:00Z`);
  const b = Date.parse(`${lastIso}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.floor((b - a) / 86_400_000);
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, unknown>;

const SEARCH_INPUT_NAME = /find the ads you've seen by searching by advertiser name or website/i;
const SEARCH_SUGGESTIONS_RE = /\/anji\/_\/rpc\/SearchService\/SearchSuggestions/i;
const ADVERTISER_ID_RE = /\bAR[A-Z0-9]{8,}\b/g;
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const NAV_TIMEOUT_MS = 45_000;
const SETTLE_TIMEOUT_MS = 15_000;
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
  signal?: AbortSignal;
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
  const match = bodyText.match(/Last shown:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i);
  return match?.[1] ?? null;
}

function parseFirstShownDateLabel(bodyText: string): string | null {
  const match = bodyText.match(/First shown:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i);
  return match?.[1] ?? null;
}

function transparencyDateLabelToIso(label: string | null): string | null {
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
}

/**
 * Transparency Center hydrates creative cards after `networkidle`; without this, Playwright often
 * collects zero `a[href*="/creative/"]` links while the SPA is still rendering (race).
 */
async function waitForTransparencyCreativeAnchors(page: Page, maxWaitMs = 20_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  const loc = page.locator('a[href*="/creative/"]');
  while (Date.now() < deadline) {
    if ((await loc.count()) > 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
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
  const creativeLinks = page.locator('a[href*="/creative/"]');
  const beforeCount = await creativeLinks.count().catch(() => 0);
  const clicked = await seeAllButton.click({ timeout: NAV_TIMEOUT_MS }).then(() => true).catch(() => false);
  if (!clicked) return false;
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const currentCount = await creativeLinks.count().catch(() => beforeCount);
    if (currentCount > beforeCount) break;
    await new Promise((r) => setTimeout(r, 200));
  }
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

const CREATIVE_PREVIEW_SCREENSHOT_TIMEOUT_MS = 12_000;
const CREATIVE_IMG_WAIT_MS = 22_000;
const CREATIVE_POST_PAINT_SETTLE_MS = 900;
/** Ignore degenerate captures (e.g. 1×1 placeholder). */
const MIN_CREATIVE_PNG_BYTES = 400;
const CREATIVE_CLIP_PADDING_X = 16;
const CREATIVE_CLIP_PADDING_Y = 12;
const MIN_CREATIVE_BOX_WIDTH = 120;
const MIN_CREATIVE_BOX_HEIGHT = 48;
const MIN_CREATIVE_BOX_AREA = 8_000;
const MAX_CREATIVE_BOX_WIDTH_RATIO = 0.88;
const MAX_CREATIVE_BOX_HEIGHT_RATIO = 0.78;
const MAX_CREATIVE_BOX_AREA_RATIO = 0.38;
const MIN_CREATIVE_TEXT_LENGTH = 18;

const SYNDICATED_IMG =
  'img[src*="googlesyndication.com"], img[src*="tpc.googlesyndication.com"], img[srcset*="googlesyndication"], img[srcset*="tpc.googlesyndication"]';
const CREATIVE_IFRAME =
  'iframe[src*="googlesyndication.com"], iframe[src*="tpc.googlesyndication.com"], iframe[src*="/archive/sadbundle/"]';
const CREATIVE_PREVIEW_ROOT_SELECTORS = [
  'html-renderer',
  '.html-container',
  '[class*="creative-container"]',
  CREATIVE_IFRAME,
  SYNDICATED_IMG,
] as const;

type ClipBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ViewportOrigin = {
  x: number;
  y: number;
};

export interface CreativePreviewCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
  textLength: number;
  imageCount: number;
  priority: number;
}

interface CreativePreviewCandidateBox extends CreativePreviewCandidate {
  clip: ClipBox;
}

type CreativePreviewCandidateRejectionReason =
  | 'non_finite'
  | 'too_small'
  | 'too_wide'
  | 'too_tall'
  | 'too_large'
  | 'low_signal'
  | 'invalid_clip';

type CreativePreviewCollectionSpec = {
  label: string;
  locator: Locator;
  priority: number;
  maxMatches: number;
};

type CreativePreviewLogContext = {
  jobId?: string;
  domain?: string;
  sourceUrl?: string;
};

function pngBufferFromScreenshot(raw: Buffer | Uint8Array): Buffer | null {
  if (!raw || raw.length < MIN_CREATIVE_PNG_BYTES) return null;
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function clipCreativePreviewBox(
  box: Pick<CreativePreviewCandidate, 'x' | 'y' | 'width' | 'height'>,
  viewport = VIEWPORT,
  viewportOrigin: ViewportOrigin = { x: 0, y: 0 },
): ClipBox | null {
  if (!isFiniteNonNegative(box.x) || !isFiniteNonNegative(box.y)) return null;
  if (!isFinitePositive(box.width) || !isFinitePositive(box.height)) return null;
  if (!isFiniteNonNegative(viewportOrigin.x) || !isFiniteNonNegative(viewportOrigin.y)) return null;
  const minViewportX = viewportOrigin.x;
  const minViewportY = viewportOrigin.y;
  const maxViewportX = viewportOrigin.x + viewport.width;
  const maxViewportY = viewportOrigin.y + viewport.height;
  const x = Math.max(minViewportX, Math.floor(viewportOrigin.x + box.x - CREATIVE_CLIP_PADDING_X));
  const y = Math.max(minViewportY, Math.floor(viewportOrigin.y + box.y - CREATIVE_CLIP_PADDING_Y));
  const maxX = Math.min(maxViewportX, Math.ceil(viewportOrigin.x + box.x + box.width + CREATIVE_CLIP_PADDING_X));
  const maxY = Math.min(maxViewportY, Math.ceil(viewportOrigin.y + box.y + box.height + CREATIVE_CLIP_PADDING_Y));
  const width = maxX - x;
  const height = maxY - y;
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

export function isAcceptableCreativePreviewCandidate(
  candidate: CreativePreviewCandidate,
  viewport = VIEWPORT,
): boolean {
  return getCreativePreviewCandidateRejectionReason(candidate, viewport) == null;
}

function getCreativePreviewCandidateRejectionReason(
  candidate: CreativePreviewCandidate,
  viewport = VIEWPORT,
): CreativePreviewCandidateRejectionReason | null {
  if (
    ![candidate.x, candidate.y, candidate.width, candidate.height, candidate.textLength, candidate.imageCount].every(
      Number.isFinite,
    )
  ) {
    return 'non_finite';
  }
  if (candidate.width < MIN_CREATIVE_BOX_WIDTH || candidate.height < MIN_CREATIVE_BOX_HEIGHT) return 'too_small';
  if (candidate.width * candidate.height < MIN_CREATIVE_BOX_AREA) return 'too_small';
  if (candidate.width > viewport.width * MAX_CREATIVE_BOX_WIDTH_RATIO) return 'too_wide';
  if (candidate.height > viewport.height * MAX_CREATIVE_BOX_HEIGHT_RATIO) return 'too_tall';
  if (candidate.width * candidate.height > viewport.width * viewport.height * MAX_CREATIVE_BOX_AREA_RATIO) return 'too_large';
  if (candidate.textLength < MIN_CREATIVE_TEXT_LENGTH && candidate.imageCount < 1) return 'low_signal';
  return clipCreativePreviewBox(candidate, viewport) != null ? null : 'invalid_clip';
}

function rankCreativePreviewCandidate(
  candidate: Pick<CreativePreviewCandidate, 'width' | 'height' | 'priority' | 'textLength' | 'imageCount'>,
): number {
  const area = candidate.width * candidate.height;
  const textBonus = Math.min(candidate.textLength, 240) * 6;
  const imageBonus = Math.min(candidate.imageCount, 4) * 150;
  return area + candidate.priority * 2_000 - textBonus - imageBonus;
}

export function pickBestCreativePreviewCandidate(
  candidates: CreativePreviewCandidate[],
  viewport = VIEWPORT,
): CreativePreviewCandidateBox | null {
  let best: CreativePreviewCandidateBox | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isAcceptableCreativePreviewCandidate(candidate, viewport)) continue;
    const clip = clipCreativePreviewBox(candidate, viewport);
    if (!clip) continue;
    const scoredCandidate: CreativePreviewCandidateBox = { ...candidate, clip };
    const score = rankCreativePreviewCandidate(scoredCandidate);
    if (score < bestScore) {
      best = scoredCandidate;
      bestScore = score;
    }
  }
  return best;
}

async function collectCreativePreviewCandidates(
  locator: Locator,
  priority: number,
  maxMatches: number,
): Promise<CreativePreviewCandidate[]> {
  const deadline = Date.now() + CREATIVE_PREVIEW_SCREENSHOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let count = 0;
    try {
      count = await locator.count();
    } catch {
      return [];
    }
    if (count < 1) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    const candidates: CreativePreviewCandidate[] = [];
    for (let i = 0; i < Math.min(count, maxMatches); i += 1) {
      const item = locator.nth(i);
      try {
        const box = await item.boundingBox();
        if (!box) continue;
        const { textLength, imageCount } = await item
          .evaluate((node) => ({
            textLength: (node.textContent ?? '').replace(/\s+/g, ' ').trim().length,
            imageCount:
              node instanceof Element
                ? node.matches('img, picture, video, canvas, svg, iframe')
                  ? 1 + node.querySelectorAll('img, picture, video, canvas, svg, iframe').length
                  : node.querySelectorAll('img, picture, video, canvas, svg, iframe').length
                : 0,
          }))
          .catch(() => ({ textLength: 0, imageCount: 0 }));
        candidates.push({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          textLength,
          imageCount,
          priority,
        });
      } catch {
        // Keep scanning other candidates if one node is detached or offscreen.
      }
    }
    if (candidates.length > 0) return candidates;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

function summarizeCreativePreviewCandidate(
  candidate: Pick<CreativePreviewCandidate, 'x' | 'y' | 'width' | 'height' | 'textLength' | 'imageCount' | 'priority'>,
): JsonObject {
  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.round(candidate.width),
    height: Math.round(candidate.height),
    textLength: candidate.textLength,
    imageCount: candidate.imageCount,
    priority: candidate.priority,
  };
}

function incrementCounter(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

async function waitForCreativePreviewRoots(page: Page, maxWaitMs = CREATIVE_IMG_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    for (const selector of CREATIVE_PREVIEW_ROOT_SELECTORS) {
      try {
        if ((await page.locator(selector).count()) > 0) return true;
      } catch {
        // The DOM can still be hydrating; keep polling until timeout.
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * Element screenshot of the ad preview on a creative detail page.
 * Waits for syndicated assets, scrolls targets into view (ECS/Xvfb can be slow),
 * then returns null if we cannot identify a tight ad-card crop.
 */
async function screenshotCreativePreview(page: Page, logContext: CreativePreviewLogContext = {}): Promise<Buffer | null> {
  await Promise.all([
    page
      .locator(SYNDICATED_IMG)
      .first()
      .waitFor({ state: 'visible', timeout: CREATIVE_IMG_WAIT_MS })
      .catch(() => {}),
    waitForCreativePreviewRoots(page).catch(() => false),
  ]);
  await new Promise((r) => setTimeout(r, CREATIVE_POST_PAINT_SETTLE_MS));

  const viewport = page.viewportSize() ?? VIEWPORT;
  const locatorAttempts: CreativePreviewCollectionSpec[] = [
    { label: 'creative_iframe', locator: page.locator(CREATIVE_IFRAME), priority: 0, maxMatches: 6 },
    { label: 'html_renderer_iframe', locator: page.locator('html-renderer iframe'), priority: 1, maxMatches: 6 },
    {
      label: 'creative_container_iframe',
      locator: page.locator('[class*="creative-container"] iframe'),
      priority: 2,
      maxMatches: 6,
    },
    { label: 'html_container', locator: page.locator('.html-container'), priority: 3, maxMatches: 4 },
    { label: 'creative_container', locator: page.locator('[class*="creative-container"]'), priority: 4, maxMatches: 4 },
    { label: 'html_renderer_children', locator: page.locator('html-renderer > *'), priority: 5, maxMatches: 8 },
    { label: 'html_renderer_grandchildren', locator: page.locator('html-renderer > * > *'), priority: 6, maxMatches: 12 },
    {
      label: 'creative_container_children',
      locator: page.locator('[class*="creative-container"] > *'),
      priority: 7,
      maxMatches: 8,
    },
    { label: 'creative_children', locator: page.locator('creative > *'), priority: 8, maxMatches: 8 },
    { label: 'html_renderer', locator: page.locator('html-renderer'), priority: 9, maxMatches: 2 },
    { label: 'creative_root', locator: page.locator('creative'), priority: 10, maxMatches: 2 },
    { label: 'syndicated_img', locator: page.locator(SYNDICATED_IMG), priority: 11, maxMatches: 4 },
  ];
  const candidateCountsByLabel: Record<string, number> = {};
  const candidateCountsByPriority: Record<string, number> = {};
  const candidates: CreativePreviewCandidate[] = [];
  const locatorResults = await Promise.all(
    locatorAttempts.map(async ({ label, locator, priority, maxMatches }) => ({
      label,
      priority,
      found: await collectCreativePreviewCandidates(locator, priority, maxMatches),
    })),
  );
  for (const { label, priority, found } of locatorResults) {
    candidateCountsByLabel[label] = found.length;
    candidateCountsByPriority[String(priority)] = (candidateCountsByPriority[String(priority)] ?? 0) + found.length;
    candidates.push(...found);
  }
  const rejectCountsByReason: Record<string, number> = {};
  for (const candidate of candidates) {
    const reason = getCreativePreviewCandidateRejectionReason(candidate, viewport);
    if (reason) incrementCounter(rejectCountsByReason, reason);
  }
  const best = pickBestCreativePreviewCandidate(candidates, viewport);
  if (!best) {
    workerJsonLog('creative_preview_selection', {
      ...logContext,
      outcome: 'no_acceptable_candidate',
      viewport,
      candidateCount: candidates.length,
      candidateCountsByLabel,
      candidateCountsByPriority,
      rejectCountsByReason,
    });
    return null;
  }

  try {
    const viewportOrigin = await page
      .evaluate(() => ({ x: window.scrollX || 0, y: window.scrollY || 0 }))
      .catch(() => ({ x: 0, y: 0 }));
    const clip = clipCreativePreviewBox(best, viewport, viewportOrigin);
    if (!clip) {
      workerJsonLog('creative_preview_selection', {
        ...logContext,
        outcome: 'clip_invalid',
        viewport,
        viewportOrigin,
        candidateCount: candidates.length,
        candidateCountsByLabel,
        candidateCountsByPriority,
        rejectCountsByReason,
        acceptedCandidate: summarizeCreativePreviewCandidate(best),
      });
      return null;
    }
    const raw = await page.screenshot({
      type: 'png',
      clip,
      animations: 'disabled',
      timeout: CREATIVE_PREVIEW_SCREENSHOT_TIMEOUT_MS,
    });
    const preview = pngBufferFromScreenshot(raw);
    workerJsonLog('creative_preview_selection', {
      ...logContext,
      outcome: preview ? 'ok' : 'png_rejected',
      viewport,
      viewportOrigin,
      candidateCount: candidates.length,
      candidateCountsByLabel,
      candidateCountsByPriority,
      rejectCountsByReason,
      acceptedCandidate: summarizeCreativePreviewCandidate(best),
      clip,
      rawByteLength: raw.length,
      previewByteLength: preview?.length ?? 0,
    });
    return preview;
  } catch (error) {
    workerJsonLog('creative_preview_selection', {
      ...logContext,
      outcome: 'screenshot_failed',
      viewport,
      candidateCount: candidates.length,
      candidateCountsByLabel,
      candidateCountsByPriority,
      rejectCountsByReason,
      acceptedCandidate: summarizeCreativePreviewCandidate(best),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function captureTopCreativeLastShown(
  page: Page,
  creativeHref: string | null,
  region: string,
  logContext: CreativePreviewLogContext = {},
): Promise<{
  latestAdLastShownAt: string | null;
  firstAdShownAt: string | null;
  creativeDetailUrl: string | null;
  creativeSummary: JsonObject | null;
  displayHeadline: string;
  displayBody: string;
  previewPng: Buffer | null;
}> {
  if (!creativeHref) {
    return {
      latestAdLastShownAt: null,
      firstAdShownAt: null,
      creativeDetailUrl: null,
      creativeSummary: null,
      displayHeadline: '',
      displayBody: '',
      previewPng: null,
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
    const firstShownLabel = parseFirstShownDateLabel(bodyText);
    const { headline: displayHeadline, body: displayBody } = await extractCreativeDisplayFromCreativePage(
      page,
      bodyText,
    );
    const previewPng = await screenshotCreativePreview(page, {
      ...logContext,
      sourceUrl: creativeUrl,
    });
    return {
      latestAdLastShownAt: transparencyDateLabelToIso(lastShownLabel),
      firstAdShownAt: transparencyDateLabelToIso(firstShownLabel),
      creativeDetailUrl: creativeUrl,
      creativeSummary: {
        page_title: trimText(await page.title().catch(() => ''), 120),
        body_snippet: trimText(bodyText, 360),
        last_shown_label: lastShownLabel,
        first_shown_label: firstShownLabel,
        region,
        display_headline: displayHeadline,
        display_body: displayBody,
      },
      displayHeadline,
      displayBody,
      previewPng,
    };
  } catch (error) {
    return {
      latestAdLastShownAt: null,
      firstAdShownAt: null,
      creativeDetailUrl: creativeUrl,
      creativeSummary: {
        error: error instanceof Error ? error.message : String(error),
        region,
      },
      displayHeadline: '',
      displayBody: '',
      previewPng: null,
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
    await waitForTransparencyCreativeAnchors(page);
    const resultsScreenshot = await maybeSaveScreenshot(page, options.outputDir ?? null, `results-${searchDomain}.png`);
    const resultsSummary = await captureResultsPageSummary(page);
    const expandedResults = await expandResultsToFullCreativeList(page);
    const creativeHrefs = await collectCreativeHrefs(page);
    const firstCreativeHref = creativeHrefs[0] ?? null;
    const firstAdvertiserId = extractAdvertiserIdFromHref(firstCreativeHref);
    const advertiserUrl = firstAdvertiserId
      ? `https://adstransparency.google.com/advertiser/${firstAdvertiserId}?region=${encodeURIComponent(region)}`
      : null;
    const topCreative = await captureTopCreativeLastShown(page, firstCreativeHref, region, {
      domain: searchDomain,
      sourceUrl: firstCreativeHref ?? undefined,
    });

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

const MIN_CREATIVES_SCANNED_BEFORE_EARLY_EXIT = 4;
const TARGET_VALID_CREATIVES_FOR_EARLY_EXIT = 2;
const MAX_CREATIVES_SCANNED_FOR_RANK_DATES = 8;

export type GoogleAdsTransparencyAuditSamplesOptions = GoogleAdsTransparencyLookupOptions & {
  maxSamples?: number;
  /** Correlates `transparency_audit_phase_timing` logs with `flux_async_jobs.id`. */
  jobId?: string;
};

/** One browser session: Transparency search → creative count + up to `maxSamples` creative detail excerpts. */
export async function runGoogleAdsTransparencyAuditSamples(
  options: GoogleAdsTransparencyAuditSamplesOptions,
): Promise<{
  searchDomain: string;
  creativeCount: number;
  latestAdLastShownAt: string | null;
  longestAdRunDays: number | null;
  samples: TransparencyCreativeSampleRow[];
  outcome: 'ok' | 'transparency_no_match' | 'transparency_zero_creatives' | 'playwright_error';
  message?: string;
}> {
  const maxSamples = Math.min(3, Math.max(1, options.maxSamples ?? 2));
  const jobId = typeof options.jobId === 'string' && options.jobId.trim() ? options.jobId.trim() : undefined;
  const searchDomain = normalizeGoogleAdsSearchDomain(options.domain);
  if (!searchDomain) {
    workerJsonLog('transparency_audit_phase_timing', {
      ...(jobId ? { jobId } : {}),
      searchDomain: '',
      outcome: 'invalid_domain',
      wallMs: 0,
      phaseMs: {},
    });
    return {
      searchDomain: '',
      creativeCount: 0,
      latestAdLastShownAt: null,
      longestAdRunDays: null,
      samples: [],
      outcome: 'playwright_error',
      message: 'Invalid domain',
    };
  }
  const region = options.region?.trim() || 'US';
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || 15_000);
  const slowMoMs = Math.max(0, Number(options.slowMoMs) || 0);
  const signal = options.signal;
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
  const samples: TransparencyCreativeSampleRow[] = [];
  const auditWallStart = Date.now();
  let mark = auditWallStart;
  const phaseMs: Record<string, number> = {};
  let attemptedCreativeCount = 0;
  let validCreativeCount = 0;
  let creativeStopReason:
    | 'collected_enough_samples'
    | 'min_reached_and_enough_valid'
    | 'max_reached'
    | 'exhausted_creatives'
    | null = null;
  const timeoutReason =
    typeof signal?.reason === 'string' && signal.reason.trim().length > 0
      ? signal.reason.trim()
      : `transparency_${searchDomain}_timeout`;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new Error(timeoutReason);
    }
  };
  const bump = (label: string) => {
    const n = Date.now();
    phaseMs[label] = n - mark;
    mark = n;
  };
  const logPhases = (outcome: string, extra: Record<string, unknown> = {}) => {
    workerJsonLog('transparency_audit_phase_timing', {
      ...(jobId ? { jobId } : {}),
      searchDomain,
      outcome,
      wallMs: Date.now() - auditWallStart,
      phaseMs: { ...phaseMs },
      attemptedCreativeCount,
      validCreativeCount,
      creativeStopReason,
      ...extra,
    });
  };
  const onAbort = () => {
    void page.close().catch(() => {});
    if (createdContext) void context.close().catch(() => {});
    if (createdBrowser) void browser.close().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    throwIfAborted();
    await openSearchPage(page, region);
    throwIfAborted();
    bump('open_home');
    const { parsedBody } = await fetchSuggestions(page, searchDomain, timeoutMs);
    throwIfAborted();
    bump('fetch_suggestions');
    const domainSuggestions = dedupeDomainSuggestions(collectDomainSuggestions(parsedBody));
    const exactSuggestion = domainSuggestions.find((candidate) => candidate.domain === searchDomain) ?? null;
    if (!exactSuggestion) {
      logPhases('transparency_no_match', { suggestionCount: domainSuggestions.length });
      return {
        searchDomain,
        creativeCount: 0,
        latestAdLastShownAt: null,
        longestAdRunDays: null,
        samples: [],
        outcome: 'transparency_no_match',
      };
    }
    await clickExactDomainSuggestion(page, searchDomain);
    throwIfAborted();
    bump('click_domain_suggestion');
    await waitForTransparencyCreativeAnchors(page);
    throwIfAborted();
    bump('wait_creative_anchors');
    await expandResultsToFullCreativeList(page);
    throwIfAborted();
    bump('expand_results_list');
    const creativeHrefs = dedupeHrefs(await collectCreativeHrefs(page));
    throwIfAborted();
    bump('collect_creative_hrefs');
    const creativeCount = creativeHrefs.length;
    if (creativeCount === 0) {
      logPhases('transparency_zero_creatives', { creativeLinkCount: 0 });
      return {
        searchDomain,
        creativeCount: 0,
        latestAdLastShownAt: null,
        longestAdRunDays: null,
        samples: [],
        outcome: 'transparency_zero_creatives',
      };
    }
    const scanN = Math.min(MAX_CREATIVES_SCANNED_FOR_RANK_DATES, creativeHrefs.length);
    let latestAdLastShownAt: string | null = null;
    let longestAdRunDays: number | null = null;
    const scanned: TransparencyScannedCreative[] = [];
    const creativeLoopStart = Date.now();
    for (let i = 0; i < scanN; i += 1) {
      const href = creativeHrefs[i] ?? null;
      if (!href) break;
      attemptedCreativeCount += 1;
      const cap = await captureTopCreativeLastShown(page, href, region, {
        ...(jobId ? { jobId } : {}),
        domain: searchDomain,
        sourceUrl: href,
      });
      throwIfAborted();
      const last = cap.latestAdLastShownAt;
      if (last) {
        if (!latestAdLastShownAt || Date.parse(`${last}T12:00:00Z`) > Date.parse(`${latestAdLastShownAt}T12:00:00Z`)) {
          latestAdLastShownAt = last;
        }
      }
      const first = cap.firstAdShownAt;
      if (first && last) {
        const run = calendarRunDaysBetween(first, last);
        if (run != null && (longestAdRunDays == null || run > longestAdRunDays)) {
          longestAdRunDays = run;
        }
      }
      const url =
        cap.creativeDetailUrl ?? (href.startsWith('http') ? href : `https://adstransparency.google.com${href}`);
      const headline = ((cap.displayHeadline || '').trim() || TRANSPARENCY_CREATIVE_FALLBACK_HEADLINE).slice(0, 200);
      const body = ((cap.displayBody || '').trim() || TRANSPARENCY_CREATIVE_FALLBACK_BODY).slice(0, 400);
      let runDays: number | null = null;
      if (first && last) {
        runDays = calendarRunDaysBetween(first, last);
      }
      scanned.push({
        sourceUrl: url,
        headline,
        body,
        latestAdLastShownAt: last,
        firstAdShownAt: first,
        runDays,
        ...(cap.previewPng && cap.previewPng.length > 0 ? { previewPng: cap.previewPng } : {}),
      });
      validCreativeCount += 1;
      if (validCreativeCount >= maxSamples && attemptedCreativeCount >= maxSamples && i + 1 < scanN) {
        creativeStopReason = 'collected_enough_samples';
        break;
      }
      if (
        attemptedCreativeCount >= MIN_CREATIVES_SCANNED_BEFORE_EARLY_EXIT &&
        validCreativeCount >= TARGET_VALID_CREATIVES_FOR_EARLY_EXIT &&
        i + 1 < scanN
      ) {
        creativeStopReason = 'min_reached_and_enough_valid';
        break;
      }
    }
    if (!creativeStopReason) {
      creativeStopReason = creativeHrefs.length > MAX_CREATIVES_SCANNED_FOR_RANK_DATES ? 'max_reached' : 'exhausted_creatives';
    }
    const creativeDetailEnd = Date.now();
    phaseMs.creative_detail_visits_ms = creativeDetailEnd - creativeLoopStart;
    mark = creativeDetailEnd;
    const picked = pickSamplesForDisplay(scanned, latestAdLastShownAt, maxSamples);
    samples.push(...picked);
    bump('pick_samples');
    throwIfAborted();
    logPhases('ok', {
      creativeCount,
      creativeDetailVisitCount: attemptedCreativeCount,
      publishedSampleCount: samples.length,
    });
    return {
      searchDomain,
      creativeCount,
      latestAdLastShownAt,
      longestAdRunDays,
      samples,
      outcome: 'ok',
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (signal?.aborted || message.endsWith('_timeout')) {
      logPhases('aborted_after_timeout', { message: timeoutReason.slice(0, 500) });
      throw new Error(timeoutReason);
    }
    logPhases('playwright_error', { message: message.slice(0, 500) });
    return {
      searchDomain,
      creativeCount: 0,
      latestAdLastShownAt: null,
      longestAdRunDays: null,
      samples: [],
      outcome: 'playwright_error',
      message,
    };
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    await page.close().catch(() => {});
    if (createdContext) await context.close().catch(() => {});
    if (createdBrowser) await browser.close().catch(() => {});
  }
}
