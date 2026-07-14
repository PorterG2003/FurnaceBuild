import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isAdWithinDays,
  isWebinarAd,
  scoreWebinarAd,
  type MetaAdLibraryWebinarAd,
} from './metaAdLibraryWebinarScan.js';
import { loadApifyCheckpoint, saveApifyCheckpoint } from './metaAdLibraryApifyCheckpoint.js';
import type { MetaAdLibraryMatchedAd } from './metaAdLibraryParse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = '../../../../tmp/meta-ads-webinar-batch-full-apify';

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function asMatchedAd(ad: Record<string, unknown>): MetaAdLibraryMatchedAd {
  return {
    library_id: (ad.library_id as string | null | undefined) ?? null,
    page_name: (ad.page_name as string | null | undefined) ?? null,
    primary_text: (ad.primary_text as string | null | undefined) ?? null,
    headline: (ad.headline as string | null | undefined) ?? null,
    landing_url: (ad.landing_url as string | null | undefined) ?? null,
    cta: (ad.cta as string | null | undefined) ?? null,
    started_running: (ad.started_running as string | null | undefined) ?? null,
    link_urls: Array.isArray(ad.link_urls) ? (ad.link_urls as string[]) : [],
  };
}

function cardFromMatchedAd(ad: MetaAdLibraryMatchedAd) {
  return {
    library_id: ad.library_id,
    page_name: ad.page_name,
    primary_text: ad.primary_text,
    headline: ad.headline,
    landing_url: ad.landing_url,
    cta: ad.cta,
    started_running: ad.started_running,
    link_urls: ad.link_urls ?? [],
    domains: [] as string[],
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const days = Number(readFlag(argv, '--days') ?? 90);
  const outDir = resolve(__dirname, readFlag(argv, '--out-dir') ?? DEFAULT_OUT_DIR);
  const checkpointPath = resolve(outDir, readFlag(argv, '--checkpoint') ?? 'apify-batch-checkpoint.json');
  const resultsPath = resolve(outDir, 'webinar-batch-results.json');
  const dryRun = argv.includes('--dry-run');

  const checkpoint = loadApifyCheckpoint(checkpointPath);
  if (!checkpoint) throw new Error(`No checkpoint at ${checkpointPath}`);

  const now = new Date();
  let companiesWithWebinar = 0;
  let companiesWithRecent = 0;
  let webinarAdsTotal = 0;
  const newlyQualified: Array<{ company_name: string; company_domain: string; webinar_ad_count: number }> =
    [];

  for (const row of checkpoint.results) {
    const matched = Array.isArray(row.matched_ads)
      ? (row.matched_ads as Record<string, unknown>[]).map(asMatchedAd)
      : [];
    const recent = matched.filter((ad) => isAdWithinDays(cardFromMatchedAd(ad), days, now));
    const webinarAds: MetaAdLibraryWebinarAd[] = [];
    for (const ad of recent) {
      if (!isWebinarAd(ad)) continue;
      const { score, signals } = scoreWebinarAd(ad);
      webinarAds.push({ ...ad, webinar_score: score, webinar_signals: signals });
    }

    const prevCount = (row.webinar_ad_count as number | undefined) ?? 0;
    row.recent_ad_count = recent.length;
    row.webinar_ad_count = webinarAds.length;
    row.webinar_ads = webinarAds;
    row.webinar_scan_days = days;

    if (recent.length > 0) companiesWithRecent += 1;
    if (webinarAds.length > 0) {
      companiesWithWebinar += 1;
      webinarAdsTotal += webinarAds.length;
      if (prevCount === 0) {
        newlyQualified.push({
          company_name: String(row.company_name ?? ''),
          company_domain: String(row.company_domain ?? ''),
          webinar_ad_count: webinarAds.length,
        });
      }
    }
  }

  checkpoint.args.webinarScanDays = days;

  const summary = {
    checkpoint: checkpointPath,
    days,
    completed: checkpoint.results.length,
    companies_with_recent_ads: companiesWithRecent,
    companies_with_webinar_ads: companiesWithWebinar,
    webinar_ads_total: webinarAdsTotal,
    newly_qualified_vs_previous: newlyQualified.length,
    newly_qualified_sample: newlyQualified.slice(0, 40),
    dry_run: dryRun,
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const backupPath = resolve(outDir, `apify-batch-checkpoint.pre-rescore-${days}d.json`);
  if (!existsSync(backupPath)) copyFileSync(checkpointPath, backupPath);
  saveApifyCheckpoint(checkpointPath, checkpoint);
  writeFileSync(resultsPath, JSON.stringify(checkpoint.results, null, 2));

  console.log(JSON.stringify({ ...summary, backup: backupPath, results_path: resultsPath }, null, 2));
  process.stderr.write(
    `[rescore] ${companiesWithWebinar} companies with webinar ads in last ${days} days (${newlyQualified.length} newly qualified vs prior window)\n`,
  );
}

main();
