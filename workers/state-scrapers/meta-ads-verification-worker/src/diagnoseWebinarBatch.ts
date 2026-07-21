import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreWebinarAd, isWebinarAd } from './metaAdLibraryWebinarScan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkpointPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      __dirname,
      '../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-07-15-meta-ads-webinar-hosts/apify-batch-checkpoint.json',
    );

type BatchRow = {
  company_name: string;
  company_domain: string;
  meta_ads_result: string;
  recent_ad_count?: number;
  webinar_ad_count?: number;
  scanned_card_count?: number;
  matched_ads?: Array<{
    primary_text?: string | null;
    headline?: string | null;
    landing_url?: string | null;
    cta?: string | null;
    page_name?: string | null;
    started_running?: string | null;
    link_urls?: string[];
  }>;
  search_attempts?: Array<{ result: string; reason: string | null; result_card_count: number }>;
};

const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
  results: BatchRow[];
  completedDomains: string[];
};

const results = checkpoint.results;
const stats = {
  total: results.length,
  yes: results.filter((r) => r.meta_ads_result === 'yes').length,
  no: results.filter((r) => r.meta_ads_result === 'no').length,
  unknown: results.filter((r) => r.meta_ads_result === 'unknown').length,
  with_recent_ads: results.filter((r) => (r.recent_ad_count ?? 0) > 0).length,
  webinar_classified: results.filter((r) => (r.webinar_ad_count ?? 0) > 0).length,
  domain_no_results: results.filter((r) =>
    r.search_attempts?.some((a) => a.reason === 'no_results'),
  ).length,
};

const rescoredHits: Array<{ domain: string; name: string; score: number; signals: string[]; url: string | null }> =
  [];
for (const row of results) {
  for (const ad of row.matched_ads ?? []) {
    const scored = scoreWebinarAd(ad);
    if (isWebinarAd(ad)) {
      rescoredHits.push({
        domain: row.company_domain,
        name: row.company_name,
        score: scored.score,
        signals: scored.signals,
        url: ad.landing_url ?? null,
      });
    }
  }
}

const copyNearMisses = results
  .filter((r) => r.meta_ads_result === 'yes')
  .flatMap((r) =>
    (r.matched_ads ?? [])
      .filter((ad) => /\bregister\b|\bconference\b|\bevent\b|\bvirtual\b/i.test(ad.primary_text ?? ''))
      .map((ad) => ({
        domain: r.company_domain,
        text: (ad.primary_text ?? '').slice(0, 100),
        url: ad.landing_url ?? null,
      })),
  )
  .slice(0, 15);

console.log(
  JSON.stringify(
    {
      checkpoint: checkpointPath,
      stats,
      rescored_webinar_hits_from_stored_matched_ads: rescoredHits.length,
      rescored_hits: rescoredHits.slice(0, 20),
      event_copy_near_misses: copyNearMisses,
      notes: [
        'Batch stores matched_ads from initial viewport only (no link_urls) — rescoring cannot recover scroll-only webinar URLs.',
        'webinar_ad_count comes from expanded scroll snapshot at lookup time.',
        'domain no_results rows never ran company-name fallback in the original batch.',
      ],
    },
    null,
    2,
  ),
);
