import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, truncateRows } from './lib/cli.js';
import { loadEnv } from './lib/env.js';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { ensureDir } from './lib/io.js';
import { fetchPage } from './lib/http.js';
import { extractTitle } from './lib/html.js';
import { sleepWithJitter } from './lib/retry.js';
import { homepageUrl, ROLE_COLUMNS } from './lib/types.js';
import { classifyFromHtml } from './classify/heuristics.js';

export async function classifyRoles(options: {
  runDir: string;
  fixtures?: boolean;
  maxRows?: number | null;
}): Promise<{ path: string }> {
  const runDir = ensureDir(options.runDir);
  const inputPath = join(runDir, 'companies_with_domains.csv');
  if (!existsSync(inputPath)) throw new Error(`Missing ${inputPath}. Run resolve first.`);

  let rows = readCsv(inputPath);
  rows = truncateRows(rows, options.maxRows ?? null);
  const out: Record<string, string>[] = [];

  for (const [index, row] of rows.entries()) {
    const usableDomain = row.website_status === 'needs_review' ? '' : (row.company_domain ?? '');
    const url = homepageUrl(usableDomain);
    let html = '';
    let title = '';
    if (url) {
      try {
        const page = await fetchPage({
          url,
          useFixtures: Boolean(options.fixtures),
          cacheDir: join(runDir, 'html-cache'),
        });
        if (page.status >= 200 && page.status < 400) {
          html = page.html;
          title = extractTitle(html);
        }
        if (!options.fixtures && !page.fromCache) await sleepWithJitter(500);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[classify ${index + 1}/${rows.length}] fetch failed ${url}: ${message}`);
        if (!options.fixtures) await sleepWithJitter(500);
      }
    }

    const classified = classifyFromHtml(row.company_name ?? '', html, title, {
      headlines: row.sample_headlines,
      titles: row.sample_titles,
    });
    console.error(
      `[classify ${index + 1}/${rows.length}] ${row.company_name || row.company_key} → ${classified.company_role}`,
    );
    out.push(
      rowToRecord({
        ...row,
        company_role: classified.company_role,
        is_compliance_platform: classified.is_compliance_platform,
        role_reason: classified.role_reason,
        role_evidence: classified.role_evidence,
      }),
    );
  }

  const outPath = join(runDir, 'companies_classified.csv');
  writeCsv(outPath, out, ROLE_COLUMNS);
  return { path: outPath };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  if (!cli.runDir) throw new Error('--run-dir is required for classify');
  const runDir = resolve(cli.runDir);
  await classifyRoles({ runDir, fixtures: cli.fixtures, maxRows: cli.maxRows });
}

if (process.argv[1]?.includes('classify-role.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
