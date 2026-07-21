import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Row = {
  company_domain: string;
  company_name: string;
  meta_ads_result: string;
  matched_ad_count?: number;
  webinar_ad_count?: number;
  recent_ad_count?: number;
};

function loadResults(path: string): Map<string, Row> {
  const checkpoint = JSON.parse(readFileSync(path, 'utf8')) as { results: Row[] };
  return new Map(checkpoint.results.map((row) => [row.company_domain, row]));
}

const baselinePath = resolve(
  process.argv[2] ??
    __dirname +
      '/../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-07-15-meta-ads-webinar-hosts/apify-batch-checkpoint.json',
);
const headedPath = resolve(
  process.argv[3] ??
    __dirname +
      '/../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-06-webinar-hosts/meta-ads-playwright/webinar-batch-checkpoint.json',
);

const baseline = loadResults(baselinePath);
const headed = loadResults(headedPath);

const flipsToYes: Array<{ domain: string; name: string; before: string; after: string; ads: number }> = [];
const flipsToNo: Array<{ domain: string; name: string; before: string; after: string }> = [];
const webinarGains: Array<{ domain: string; name: string; before: number; after: number }> = [];

for (const [domain, afterRow] of headed) {
  const beforeRow = baseline.get(domain);
  if (!beforeRow) continue;
  if (beforeRow.meta_ads_result !== 'yes' && afterRow.meta_ads_result === 'yes') {
    flipsToYes.push({
      domain,
      name: afterRow.company_name,
      before: beforeRow.meta_ads_result,
      after: afterRow.meta_ads_result,
      ads: afterRow.matched_ad_count ?? 0,
    });
  }
  if (beforeRow.meta_ads_result === 'yes' && afterRow.meta_ads_result !== 'yes') {
    flipsToNo.push({
      domain,
      name: afterRow.company_name,
      before: beforeRow.meta_ads_result,
      after: afterRow.meta_ads_result,
    });
  }
  const beforeWebinar = beforeRow.webinar_ad_count ?? 0;
  const afterWebinar = afterRow.webinar_ad_count ?? 0;
  if (afterWebinar > beforeWebinar) {
    webinarGains.push({
      domain,
      name: afterRow.company_name,
      before: beforeWebinar,
      after: afterWebinar,
    });
  }
}

function countResults(rows: Map<string, Row>): Record<string, number> {
  const stats = { yes: 0, no: 0, unknown: 0 };
  for (const row of rows.values()) {
    stats[row.meta_ads_result as keyof typeof stats] += 1;
  }
  return stats;
}

console.log(
  JSON.stringify(
    {
      baseline: { path: baselinePath, count: baseline.size, stats: countResults(baseline) },
      headed: { path: headedPath, count: headed.size, stats: countResults(headed) },
      flips_to_yes: flipsToYes.length,
      flips_to_no: flipsToNo.length,
      webinar_gains: webinarGains.length,
      flip_to_yes_samples: flipsToYes.slice(0, 30),
      flip_to_no_samples: flipsToNo.slice(0, 15),
      webinar_gain_samples: webinarGains.slice(0, 15),
    },
    null,
    2,
  ),
);
