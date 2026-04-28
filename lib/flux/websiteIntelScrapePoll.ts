import {
  fetchFoundryJob,
  fetchWebsiteIntelligenceByDomain,
  postWebsiteIntelligenceScrape,
} from '@/lib/foundry/registry-client';
import type { WebsiteIntelLookupResponse } from '@/lib/foundry/registry-types';
import type { FluxWebsiteIntelSnapshot } from '@/lib/flux/types';

export const WEBSITE_SCRAPE_POLL_TIMEOUT_MS = 5 * 60 * 1000;
export const WEBSITE_SCRAPE_POLL_INTERVAL_MS = 5000;
export const WEBSITE_SCRAPE_POLL_MAX_ATTEMPTS = Math.ceil(
  WEBSITE_SCRAPE_POLL_TIMEOUT_MS / WEBSITE_SCRAPE_POLL_INTERVAL_MS,
);
const WEBSITE_SCRAPE_JOB_START_SLACK_MS = 15_000;

/** Foundry can flip to `completed` slightly before crawl/intel rows are visible; brief retries fix empty UI. */
const POST_COMPLETE_INTEL_LOOKUP_MAX_ATTEMPTS = 20;
const POST_COMPLETE_INTEL_LOOKUP_DELAY_MS = 600;

async function fetchWebsiteIntelAfterJobMarkedComplete(url: string): Promise<WebsiteIntelLookupResponse> {
  let last = await fetchWebsiteIntelligenceByDomain(url);
  for (let i = 0; i < POST_COMPLETE_INTEL_LOOKUP_MAX_ATTEMPTS && !last.hit; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, POST_COMPLETE_INTEL_LOOKUP_DELAY_MS));
    last = await fetchWebsiteIntelligenceByDomain(url);
  }
  return last;
}

export function isCrawlFreshForJob(crawledAt: string | undefined, jobStartedAt: string | null): boolean {
  if (!crawledAt || !jobStartedAt) return false;
  const crawledMs = new Date(crawledAt).getTime();
  const startedMs = new Date(jobStartedAt).getTime();
  if (!Number.isFinite(crawledMs) || !Number.isFinite(startedMs)) return false;
  return crawledMs >= startedMs - WEBSITE_SCRAPE_JOB_START_SLACK_MS;
}

export type WebsiteIntelScrapePollResult =
  | { ok: true; snapshot: FluxWebsiteIntelSnapshot; stale: boolean }
  | { ok: true; snapshot: null; stale: false; message: string }
  | { ok: false; message: string };

/**
 * Starts a website intelligence scrape (if needed) and polls until intel is readable or job completes.
 */
export async function runWebsiteIntelligenceScrapePoll(params: {
  url: string;
  force?: boolean;
}): Promise<WebsiteIntelScrapePollResult> {
  const trimmed = params.url.trim();
  if (!trimmed) {
    return { ok: false, message: 'URL is required.' };
  }
  const force = params.force === true;
  try {
    const started = await postWebsiteIntelligenceScrape({ url: trimmed, force });
    if (!started.jobId) {
      const lookup = await fetchWebsiteIntelligenceByDomain(trimmed);
      if (lookup.hit) {
        return { ok: true, snapshot: lookup as FluxWebsiteIntelSnapshot, stale: !!lookup.stale };
      }
      return { ok: true, snapshot: null, stale: false, message: 'No cached website intel yet.' };
    }

    for (let attempt = 0; attempt < WEBSITE_SCRAPE_POLL_MAX_ATTEMPTS; attempt += 1) {
      const job = await fetchFoundryJob(started.jobId);
      const jobStartedAt = job.job.started_at ?? null;

      if (job.job.status === 'completed') {
        const lookup = await fetchWebsiteIntelAfterJobMarkedComplete(trimmed);
        if (lookup.hit) {
          return { ok: true, snapshot: lookup as FluxWebsiteIntelSnapshot, stale: !!lookup.stale };
        }
        return {
          ok: true,
          snapshot: null,
          stale: false,
          message: 'Scrape finished, but no usable website intel was found.',
        };
      }
      if (job.job.status === 'failed') {
        return { ok: false, message: job.job.error_summary || 'Website scrape failed.' };
      }

      if (job.job.status === 'running' || job.job.status === 'queued') {
        const lookup = await fetchWebsiteIntelligenceByDomain(trimmed);
        if (lookup.hit && isCrawlFreshForJob(lookup.crawled_at, jobStartedAt)) {
          return { ok: true, snapshot: lookup as FluxWebsiteIntelSnapshot, stale: !!lookup.stale };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, WEBSITE_SCRAPE_POLL_INTERVAL_MS));
    }
    return { ok: false, message: 'Timed out waiting for website scrape.' };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : 'Website scrape failed.' };
  }
}
