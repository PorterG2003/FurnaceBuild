import { ApifyClient } from 'apify-client';
import { loadApifyTokenFromEnvOrSsm } from './apifyBatchEnv.js';

export const LEADSBRARY_ACTOR = 'leadsbrary/meta-ads-library-scraper';
export const OFFICIAL_ACTOR = 'apify/facebook-ads-scraper';

export type ApifyActorKind = 'leadsbrary' | 'official';

export const APIFY_URL_CHUNK_SIZE = 25;

export interface ApifySearchTarget {
  url: string;
  domain: string;
  searchTerm: string;
  searchKind: 'domain' | 'name';
}

export interface ApifyCountResult {
  sourceUrl: string;
  totalCount: number;
  raw: Record<string, unknown>;
}

export interface ApifyRunSummary {
  actorId: string;
  runId: string;
  datasetId: string;
  itemCount: number;
  rateLimited: boolean;
}

export function isMetaRateLimitText(text: string): boolean {
  return /#613|exceeded the rate limit|Calls to this api have exceeded the rate limit/i.test(text);
}

export async function runLogLooksRateLimited(client: ApifyClient, runId: string): Promise<boolean> {
  try {
    const log = await client.run(runId).log().get();
    if (typeof log === 'string') return isMetaRateLimitText(log);
    if (log && typeof log === 'object' && 'download' in log) {
      // Some client versions return a LogClient; fall through to get() already used.
    }
    return false;
  } catch {
    return false;
  }
}

export function requireApifyToken(): string {
  return loadApifyTokenFromEnvOrSsm();
}

export function createApifyClient(token?: string): ApifyClient {
  return new ApifyClient({ token: token ?? requireApifyToken() });
}

export function actorIdForKind(kind: ApifyActorKind): string {
  return kind === 'official' ? OFFICIAL_ACTOR : LEADSBRARY_ACTOR;
}

export function buildCountInput(kind: ApifyActorKind, urls: string[]): Record<string, unknown> {
  if (kind === 'official') {
    return {
      startUrls: urls.map((url) => ({ url })),
      onlyTotal: true,
      activeStatus: 'active',
    };
  }
  return {
    startUrls: urls,
    onlyTotalCount: false,
    maxResults: 1,
    activeStatus: 'ACTIVE',
    countryFallback: 'US',
    scrapeAdDetails: false,
    includeAboutPage: false,
  };
}

export function buildFullPullInput(kind: ApifyActorKind, urls: string[], maxResults: number): Record<string, unknown> {
  if (kind === 'official') {
    return {
      startUrls: urls.map((url) => ({ url })),
      onlyTotal: false,
      resultsLimit: maxResults,
      isDetailsPerAd: true,
      includeAboutPage: true,
      activeStatus: 'active',
    };
  }
  return {
    startUrls: urls,
    onlyTotalCount: false,
    maxResults,
    scrapeAdDetails: true,
    includeAboutPage: true,
    activeStatus: 'ACTIVE',
    countryFallback: 'US',
  };
}

function normalizeSourceUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function pickTotalCount(item: Record<string, unknown>): number {
  const candidates = [
    item.totalCount,
    item.totalAds,
    item.total_ad_count,
    item.adsCount,
    item.count,
    item.total,
    item.resultCount,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.max(0, Math.trunc(candidate));
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
    }
  }
  return 0;
}

function isAdLikeRecord(item: Record<string, unknown>): boolean {
  return Boolean(item.adArchiveID || item.adText || item.pageName || item.ctaDomain);
}

export function parseCountResults(items: Record<string, unknown>[]): ApifyCountResult[] {
  const summaryRows = items
    .map((item) => {
      const totalCount = pickTotalCount(item);
      if (totalCount <= 0) return null;
      const sourceUrl =
        normalizeSourceUrl(item.sourceUrl) ||
        normalizeSourceUrl(item.searchUrl) ||
        normalizeSourceUrl(item.url) ||
        normalizeSourceUrl(item.startUrl);
      return { sourceUrl, totalCount, raw: item };
    })
    .filter((row): row is ApifyCountResult => row !== null);

  if (summaryRows.length > 0) return summaryRows;

  const adLike = items.filter(isAdLikeRecord);
  if (adLike.length === 0) {
    return items.map((item) => ({
      sourceUrl:
        normalizeSourceUrl(item.sourceUrl) ||
        normalizeSourceUrl(item.searchUrl) ||
        normalizeSourceUrl(item.url) ||
        normalizeSourceUrl(item.startUrl),
      totalCount: pickTotalCount(item),
      raw: item,
    }));
  }

  const bySource = new Map<string, number>();
  for (const item of adLike) {
    const sourceUrl =
      normalizeSourceUrl(item.sourceUrl) ||
      normalizeSourceUrl(item.searchUrl) ||
      normalizeSourceUrl(item.url) ||
      normalizeSourceUrl(item.startUrl) ||
      '';
    bySource.set(sourceUrl, (bySource.get(sourceUrl) ?? 0) + 1);
  }

  if (bySource.size === 1) {
    const [sourceUrl, totalCount] = [...bySource.entries()][0]!;
    return [{ sourceUrl, totalCount, raw: { mode: 'inferred_from_ads', ad_rows: totalCount } }];
  }

  return [...bySource.entries()].map(([sourceUrl, totalCount]) => ({
    sourceUrl,
    totalCount,
    raw: { mode: 'inferred_from_ads', ad_rows: totalCount },
  }));
}

export function chunkTargets<T>(items: T[], size = APIFY_URL_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function runActorDataset(
  client: ApifyClient,
  actorId: string,
  input: Record<string, unknown>,
): Promise<{ items: Record<string, unknown>[]; summary: ApifyRunSummary }> {
  const run = await client.actor(actorId).call(input);
  const datasetId = run.defaultDatasetId;
  if (!datasetId) {
    throw new Error(`Actor ${actorId} run ${run.id} did not produce a default dataset`);
  }
  const { items } = await client.dataset(datasetId).listItems({ limit: 10_000 });
  const normalized = items.map((item) => item as Record<string, unknown>);
  // Only inspect logs on empty datasets — rate-limit hits usually complete with 0 ads.
  const rateLimited =
    normalized.length === 0 ? await runLogLooksRateLimited(client, run.id) : false;
  return {
    items: normalized,
    summary: {
      actorId,
      runId: run.id,
      datasetId,
      itemCount: normalized.length,
      rateLimited,
    },
  };
}

export class MetaRateLimitError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Meta API rate limit (#613) detected on Apify run ${runId}`);
    this.name = 'MetaRateLimitError';
    this.runId = runId;
  }
}

export async function runCountForUrls(
  client: ApifyClient,
  kind: ApifyActorKind,
  urls: string[],
): Promise<{ counts: ApifyCountResult[]; summary: ApifyRunSummary }> {
  const actorId = actorIdForKind(kind);
  const { items, summary } = await runActorDataset(client, actorId, buildCountInput(kind, urls));
  if (summary.rateLimited) throw new MetaRateLimitError(summary.runId);
  return { counts: parseCountResults(items), summary };
}

export async function runFullPullForUrls(
  client: ApifyClient,
  kind: ApifyActorKind,
  urls: string[],
  maxResults: number,
): Promise<{ items: Record<string, unknown>[]; summary: ApifyRunSummary }> {
  const actorId = actorIdForKind(kind);
  const result = await runActorDataset(client, actorId, buildFullPullInput(kind, urls, maxResults));
  if (result.summary.rateLimited) throw new MetaRateLimitError(result.summary.runId);
  return result;
}

export function matchCountToTarget(
  counts: ApifyCountResult[],
  target: ApifySearchTarget,
): ApifyCountResult | null {
  const normalizedTarget = target.url.replace(/&amp;/g, '&');
  for (const count of counts) {
    const normalizedSource = count.sourceUrl.replace(/&amp;/g, '&');
    if (normalizedSource === normalizedTarget) return count;
    if (normalizedSource && normalizedTarget.includes(normalizedSource)) return count;
    if (normalizedSource && normalizedSource.includes(normalizedTarget)) return count;
  }
  if (counts.length === 1) return counts[0] ?? null;
  const inferred = counts.find((count) => count.totalCount > 0);
  if (inferred && counts.every((count) => !count.sourceUrl || count.sourceUrl === inferred.sourceUrl)) {
    return inferred;
  }
  return null;
}
