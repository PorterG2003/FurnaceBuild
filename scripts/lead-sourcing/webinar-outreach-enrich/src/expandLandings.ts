import { chromium, type Browser } from 'playwright';
import { join } from 'node:path';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { normalizeDomain } from './types.js';
import { scoreDomainCandidate, type ScoredDomain } from './domainScore.js';

export type ExpandResult = {
  ad_id: string;
  company_name: string;
  platform: string;
  person_name: string;
  source_url: string;
  final_url: string;
  discovered_domain: string;
  score: string;
  tier: string;
  status: string;
  error: string;
  ad_library_url: string;
};

const COLUMNS = [
  'ad_id',
  'company_name',
  'platform',
  'person_name',
  'source_url',
  'final_url',
  'discovered_domain',
  'score',
  'tier',
  'status',
  'error',
  'ad_library_url',
];

async function expandWithFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    return resp.url || url;
  } finally {
    clearTimeout(timer);
  }
}

async function expandWithPlaywright(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return page.url();
  } finally {
    await page.close();
  }
}

export async function expandLandings(options: {
  inputCsv: string;
  outDir: string;
  dryRun?: boolean;
  maxRows?: number | null;
  usePlaywright?: boolean;
}): Promise<{ path: string; recovered: number; attempted: number }> {
  const outDir = ensureDir(options.outDir);
  const outPath = join(outDir, 'domains_from_redirect.csv');
  const checkpointPath = join(outDir, 'expand_checkpoint.json');

  let rows = readCsv(options.inputCsv).filter((r) => (r.expandable_url || '').trim());
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      expandable_rows: rows.length,
      note: 'No Serper spend. Playwright/fetch redirect expansion only.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(outDir, 'expand_dry_run.json'), estimate);
    return { path: outPath, recovered: 0, attempted: 0 };
  }

  type Checkpoint = { next_index: number; results: ExpandResult[] };
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? { next_index: 0, results: [] };

  let browser: Browser | null = null;
  const usePw = options.usePlaywright !== false;

  try {
    if (usePw) {
      browser = await chromium.launch({ headless: true });
    }

    for (let i = checkpoint.next_index; i < rows.length; i++) {
      const row = rows[i]!;
      const source = row.expandable_url;
      console.error(`[expand] ${i + 1}/${rows.length} ${row.company_name}`);

      let finalUrl = '';
      let error = '';
      try {
        if (browser) {
          try {
            finalUrl = await expandWithPlaywright(browser, source);
          } catch {
            finalUrl = await expandWithFetch(source);
          }
        } else {
          finalUrl = await expandWithFetch(source);
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const domain = normalizeDomain(finalUrl);
      let scored: ScoredDomain | null = null;
      if (domain) {
        scored = scoreDomainCandidate(row.company_name, {
          domain,
          source: 'redirect',
          title: finalUrl,
        });
      }

      const result: ExpandResult = {
        ad_id: row.ad_id ?? '',
        company_name: row.company_name ?? '',
        platform: row.platform ?? '',
        person_name: row.person_name ?? '',
        source_url: source,
        final_url: finalUrl,
        discovered_domain: scored?.domain ?? '',
        score: scored ? String(scored.score) : '0',
        tier: scored?.tier ?? 'low',
        status: scored && scored.tier !== 'low' ? 'candidate' : 'no_usable_domain',
        error,
        ad_library_url: row.ad_library_url ?? '',
      };
      checkpoint.results.push(result);
      checkpoint.next_index = i + 1;
      writeJson(checkpointPath, checkpoint);
      writeCsv(outPath, checkpoint.results, COLUMNS);
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    if (browser) await browser.close();
  }

  const recovered = checkpoint.results.filter(
    (r) => r.status === 'candidate' && (r.tier === 'high' || r.tier === 'medium'),
  ).length;
  writeJson(join(outDir, 'expand_tally.json'), {
    attempted: checkpoint.results.length,
    recovered_candidates: recovered,
    high: checkpoint.results.filter((r) => r.tier === 'high').length,
    medium: checkpoint.results.filter((r) => r.tier === 'medium').length,
  });
  console.log(
    JSON.stringify(
      { done: true, attempted: checkpoint.results.length, recovered_candidates: recovered },
      null,
      2,
    ),
  );
  return { path: outPath, recovered, attempted: checkpoint.results.length };
}
