import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type CompareRow = {
  company_domain: string;
  company_name: string;
  meta_ads_result: string;
  empty_no_result?: boolean;
  matched_ad_count?: number;
  webinar_ad_count?: number;
  provider?: string;
};

function loadResults(path: string): Map<string, CompareRow> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { results?: CompareRow[] } | CompareRow[];
  const rows = Array.isArray(raw) ? raw : raw.results ?? [];
  return new Map(rows.map((row) => [row.company_domain, row]));
}

const apifyPath = resolve(
  process.argv[2] ??
    __dirname +
      '/../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-07-15-meta-ads-webinar-hosts/apify-batch-checkpoint.json',
);
const playwrightPath = resolve(
  process.argv[3] ??
    __dirname +
      '/../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-06-webinar-hosts/meta-ads-pilot-playwright/webinar-batch-checkpoint.json',
);

const apify = loadResults(apifyPath);
const playwright = loadResults(playwrightPath);

const agreement = { same: 0, different: 0 };
const apifyYesPlaywrightEmpty: CompareRow[] = [];
const apifyYesPlaywrightNo: CompareRow[] = [];
const webinarDeltas: Array<{
  domain: string;
  name: string;
  apify: number;
  playwright: number;
}> = [];

for (const [domain, apifyRow] of apify) {
  const playwrightRow = playwright.get(domain);
  if (!playwrightRow) continue;
  if (apifyRow.meta_ads_result === playwrightRow.meta_ads_result) agreement.same += 1;
  else agreement.different += 1;

  if (apifyRow.meta_ads_result === 'yes' && playwrightRow.empty_no_result) {
    apifyYesPlaywrightEmpty.push(apifyRow);
  }
  if (apifyRow.meta_ads_result === 'yes' && playwrightRow.meta_ads_result === 'no') {
    apifyYesPlaywrightNo.push(apifyRow);
  }

  const apifyWebinar = apifyRow.webinar_ad_count ?? 0;
  const playwrightWebinar = playwrightRow.webinar_ad_count ?? 0;
  if (apifyWebinar !== playwrightWebinar) {
    webinarDeltas.push({
      domain,
      name: apifyRow.company_name,
      apify: apifyWebinar,
      playwright: playwrightWebinar,
    });
  }
}

function countStats(rows: Map<string, CompareRow>): Record<string, number> {
  return {
    yes: [...rows.values()].filter((row) => row.meta_ads_result === 'yes').length,
    no: [...rows.values()].filter((row) => row.meta_ads_result === 'no').length,
    unknown: [...rows.values()].filter((row) => row.meta_ads_result === 'unknown').length,
    empty_no_result: [...rows.values()].filter((row) => row.empty_no_result === true).length,
    webinar: [...rows.values()].filter((row) => (row.webinar_ad_count ?? 0) > 0).length,
  };
}

console.log(
  JSON.stringify(
    {
      apify: { path: apifyPath, count: apify.size, stats: countStats(apify) },
      playwright: { path: playwrightPath, count: playwright.size, stats: countStats(playwright) },
      overlap_domains: agreement.same + agreement.different,
      agreement,
      apify_yes_while_playwright_empty: apifyYesPlaywrightEmpty.length,
      apify_yes_while_playwright_no: apifyYesPlaywrightNo.length,
      apify_yes_playwright_empty_samples: apifyYesPlaywrightEmpty.slice(0, 20),
      apify_yes_playwright_no_samples: apifyYesPlaywrightNo.slice(0, 20),
      webinar_deltas: webinarDeltas.slice(0, 20),
    },
    null,
    2,
  ),
);
