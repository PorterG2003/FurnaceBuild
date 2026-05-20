import type { Page } from 'playwright';
import competitorAuditAdvertiser from '../../../../lib/flux/fluxCompetitorAuditAdvertiser.js';

export const TRANSPARENCY_CREATIVE_FALLBACK_HEADLINE = 'Ad creative';
export const TRANSPARENCY_CREATIVE_FALLBACK_BODY =
  'View the full creative on Google Ads Transparency (link below).';

/** One creative after a Transparency detail-page visit. */
export interface TransparencyScannedCreative {
  sourceUrl: string;
  headline: string;
  body: string;
  latestAdLastShownAt: string | null;
  firstAdShownAt: string | null;
  runDays: number | null;
  /**
   * In-memory PNG from Playwright only. Never serialize to JSON or DB.
   */
  previewPng?: Buffer;
}

export interface TransparencyCreativeSampleRow {
  sourceUrl: string;
  headline: string;
  body: string;
  /** In-memory only until uploaded; never persist on page_config. */
  previewPng?: Buffer;
}

function hasPreviewPng(row: Pick<TransparencyScannedCreative, 'previewPng'>): boolean {
  return Boolean(row.previewPng && row.previewPng.length > 0);
}

const CHROME_EXACT = new Set(
  [
    'Ads Transparency Center',
    'Sign in',
    'FAQ',
    'Home',
    'Ad details',
    'close',
    'Verified',
    'All topics',
    'Political ads',
    'United States',
    'keyboard_arrow_right',
    'keyboard_arrow_left',
    'arrow_forward',
    'arrow_back',
    'chevron_left',
    'chevron_right',
  ].map((s) => s.toLowerCase()),
);

function isChromeLine(raw: string): boolean {
  const t = raw.trim();
  if (t.length === 0) return true;
  const lower = t.toLowerCase();
  if (CHROME_EXACT.has(lower)) return true;
  if (lower === 'flag') return true;
  // Transparency footer / policy row often glued to disclosure text
  if (/flag\s+principles/i.test(lower)) return true;
  if (/principlesads/i.test(lower.replace(/\s+/g, ''))) return true;
  if (/\bprinciples\s*ads\s*blog\b/i.test(lower)) return true;
  if (t.length <= 2) return true;
  if (/^arrow_/i.test(t)) return true;
  if (/^keyboard_arrow_/i.test(t)) return true;
  if (/^chevron_/i.test(t)) return true;
  if (/^~\d/.test(t) && /\bads\b/i.test(t)) return true;
  if (/^last shown:/i.test(t)) return true;
  if (/^first shown:/i.test(t)) return true;
  if (/^format:/i.test(t)) return true;
  if (/^shown in the\b/i.test(t)) return true;
  if (/report this ad/i.test(t)) return true;
  if (/see more ads/i.test(t)) return true;
  if (/\bof \d+ variations\b/i.test(t)) return true;
  if (/^privacyterms/i.test(t)) return true;
  if (/^the information about this ad may vary/i.test(t)) return true;
  if (lower.includes('transparency center') && t.length < 100) return true;
  if (/^cookie/i.test(t) && t.length < 80) return true;
  return false;
}

function dedupeAdjacentLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length > 0 && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out;
}

function linesFromText(text: string): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isChromeLine(line));
  return dedupeAdjacentLines(lines);
}

/**
 * Derive recipient-facing headline/body from creative page text (main region or full body innerText).
 */
export function extractCreativeDisplayFromInnerText(fullText: string): { headline: string; body: string } {
  const lines = linesFromText(fullText);
  if (lines.length === 0) {
    return { headline: TRANSPARENCY_CREATIVE_FALLBACK_HEADLINE, body: TRANSPARENCY_CREATIVE_FALLBACK_BODY };
  }
  const headline = lines[0].slice(0, 200);
  const rest = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();
  let body = rest.slice(0, 400);
  if (!body && lines[0].length > headline.length) {
    body = lines[0].slice(headline.length).replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  if (!body) {
    body = TRANSPARENCY_CREATIVE_FALLBACK_BODY;
  }
  return { headline, body };
}

const MAIN_MIN_CHARS = 40;

/** Prefer <main> innerText when it is substantial; otherwise use full body text. */
export async function extractCreativeDisplayFromCreativePage(
  page: Page,
  bodyFullText: string,
): Promise<{ headline: string; body: string }> {
  let raw = '';
  try {
    const main = page.locator('main').first();
    if ((await main.count()) > 0) {
      const t = await main.innerText().catch(() => '');
      const collapsed = t.replace(/\s+/g, ' ').trim();
      if (collapsed.length >= MAIN_MIN_CHARS) raw = t;
    }
  } catch {
    /* ignore */
  }
  if (!raw) raw = bodyFullText;
  return extractCreativeDisplayFromInnerText(raw);
}

/**
 * Pick up to `maxSamples` creatives for the published cards: prefer rows with preview screenshots,
 * then rows whose last-shown date equals the global max, then longer First→Last run, then most
 * recent last-shown, stable by input order.
 */
export function pickSamplesForDisplay(
  scanned: TransparencyScannedCreative[],
  globalLatestIso: string | null,
  maxSamples: number,
  options: { requiredAdvertiserId?: string | null } = {},
): TransparencyCreativeSampleRow[] {
  if (scanned.length === 0 || maxSamples < 1) return [];
  const filteredScanned = competitorAuditAdvertiser.filterExamplesToAdvertiser(scanned, options.requiredAdvertiserId ?? null);
  if (filteredScanned.length === 0) return [];
  const globalTs = globalLatestIso ? Date.parse(`${globalLatestIso}T12:00:00Z`) : NaN;
  const decorated = filteredScanned.map((row, index) => {
    const lastTs = row.latestAdLastShownAt ? Date.parse(`${row.latestAdLastShownAt}T12:00:00Z`) : NaN;
    const hasPreview = hasPreviewPng(row) ? 1 : 0;
    const matchesGlobal =
      Number.isFinite(globalTs) && Number.isFinite(lastTs) && lastTs === globalTs ? 1 : 0;
    const run = row.runDays ?? -1;
    return { row, index, hasPreview, lastTs, matchesGlobal, run };
  });
  decorated.sort((a, b) => {
    if (b.hasPreview !== a.hasPreview) return b.hasPreview - a.hasPreview;
    if (b.matchesGlobal !== a.matchesGlobal) return b.matchesGlobal - a.matchesGlobal;
    if (b.run !== a.run) return b.run - a.run;
    const bt = Number.isFinite(b.lastTs) ? b.lastTs : -Infinity;
    const at = Number.isFinite(a.lastTs) ? a.lastTs : -Infinity;
    if (bt !== at) return bt - at;
    return a.index - b.index;
  });
  const out: TransparencyCreativeSampleRow[] = [];
  const seenUrl = new Set<string>();
  const seenAdvertiserId = new Set<string>();
  for (const { row } of decorated) {
    if (out.length >= maxSamples) break;
    if (seenUrl.has(row.sourceUrl)) continue;
    const advertiserId = competitorAuditAdvertiser.extractGoogleAdsAdvertiserId(row.sourceUrl);
    if (options.requiredAdvertiserId && advertiserId && advertiserId !== options.requiredAdvertiserId) continue;
    if (options.requiredAdvertiserId && advertiserId == null) continue;
    if (!options.requiredAdvertiserId && advertiserId && seenAdvertiserId.size > 0 && !seenAdvertiserId.has(advertiserId)) {
      continue;
    }
    seenUrl.add(row.sourceUrl);
    if (advertiserId) seenAdvertiserId.add(advertiserId);
    out.push({
      sourceUrl: row.sourceUrl,
      headline: row.headline,
      body: row.body,
      ...(row.previewPng && row.previewPng.length > 0 ? { previewPng: row.previewPng } : {}),
    });
  }
  return out;
}
