import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir, truncateRows } from './lib/cli.js';
import { loadEnv, ensureEnv, packageRoot } from './lib/env.js';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { ensureDir, loadJson, writeJson } from './lib/io.js';
import { fetchPage } from './lib/http.js';
import { extractLinks } from './lib/html.js';
import { sleep, sleepWithJitter } from './lib/retry.js';
import { serperSearch } from './lib/serperClient.js';
import { homepageUrl, SOC2_COLUMNS } from './lib/types.js';
import {
  detectSoc2FromSerper,
  detectSoc2OnPage,
  emptySoc2,
  isInSiteOrTrustHost,
  isTrustLink,
  type Soc2Hit,
} from './soc2/detect.js';

type Checkpoint = {
  next_index: number;
  results: Record<string, string>[];
  serper_calls: number;
  pages_fetched: number;
  pending_keys?: string[];
};

function isUsableDomain(row: Record<string, string>): boolean {
  return Boolean(row.company_domain && row.website_status !== 'needs_review');
}

export async function enrichSoc2(options: {
  runDir: string;
  dryRun?: boolean;
  live?: boolean;
  fixtures?: boolean;
  maxRows?: number | null;
  retryUnknown?: boolean;
}): Promise<{ path: string }> {
  const runDir = ensureDir(options.runDir);
  const classifiedPath = join(runDir, 'companies_classified.csv');
  if (!options.dryRun && !existsSync(classifiedPath)) {
    throw new Error(`Missing ${classifiedPath}. Run classify first.`);
  }
  const fallbackPath = existsSync(join(runDir, 'companies_with_domains.csv'))
    ? join(runDir, 'companies_with_domains.csv')
    : join(runDir, 'companies.csv');
  const inputPath = existsSync(classifiedPath) ? classifiedPath : fallbackPath;
  if (!existsSync(inputPath)) throw new Error(`Missing ${classifiedPath}. Run classify first.`);

  let rows = readCsv(inputPath);
  rows = truncateRows(rows, options.maxRows ?? null);
  const outPath = join(runDir, 'companies_soc2.csv');
  const checkpointPath = join(
    runDir,
    options.retryUnknown ? 'soc2_unknown_checkpoint.json' : 'soc2_checkpoint.json',
  );

  let fullRows: Record<string, string>[] | null = null;
  if (options.retryUnknown) {
    if (!existsSync(outPath)) throw new Error(`Missing ${outPath}. Run soc2 first.`);
    fullRows = readCsv(outPath);
    const pending = fullRows.filter((r) => r.has_soc2 === 'unknown' && isUsableDomain(r));
    rows = truncateRows(pending, options.maxRows ?? null);
  }

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      retry_unknown: Boolean(options.retryUnknown),
      companies: rows.length,
      estimated_serper_site_searches: rows.filter((r) => isUsableDomain(r) && r.has_soc2 !== 'yes').length,
      note: options.retryUnknown
        ? 'Re-runs Serper only for companies still has_soc2=unknown with a usable domain.'
        : 'Serper site: search runs only when homepage/trust-page scrape does not find SOC2.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'soc2_dry_run.json'), estimate);
    return { path: outPath };
  }

  const willSearch = Boolean(options.fixtures) || Boolean(options.live);
  if (willSearch && !options.fixtures) {
    await ensureEnv({ serper: true });
    if (!process.env.SERPER_API_KEY?.trim()) {
      throw new Error('SERPER_API_KEY not available');
    }
  }

  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    next_index: 0,
    results: [],
    serper_calls: 0,
    pages_fetched: 0,
    pending_keys: options.retryUnknown ? rows.map((r) => r.company_key) : undefined,
  };

  if (options.retryUnknown && checkpoint.pending_keys?.length && fullRows) {
    const byKey = new Map(fullRows.map((r) => [r.company_key, r]));
    rows = checkpoint.pending_keys.map((key) => byKey.get(key)).filter((r): r is Record<string, string> => Boolean(r));
  }

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    const row = rows[i]!;
    const domain = row.website_status === 'needs_review' ? '' : (row.company_domain ?? '');
    console.error(`[soc2 ${i + 1}/${rows.length}] ${row.company_name || row.company_key}`);

    let hit: Soc2Hit = emptySoc2('unknown');
    let homepageOk = false;

    if (domain) {
      const homeUrl = homepageUrl(domain);
      try {
        const home = await fetchPage({
          url: homeUrl,
          useFixtures: Boolean(options.fixtures),
          cacheDir: join(runDir, 'html-cache'),
        });
        if (home.status >= 200 && home.status < 400 && home.html) {
          homepageOk = true;
          checkpoint.pages_fetched += 1;
          hit = detectSoc2OnPage({ html: home.html, url: homeUrl, method: 'homepage' }) ?? hit;

          if (hit.has_soc2 !== 'yes') {
            const trustLink = extractLinks(home.html, homeUrl).find(
              (l) => isTrustLink(l.href, l.text) && isInSiteOrTrustHost(l.href, domain),
            );
            if (trustLink) {
              const trust = await fetchPage({
                url: trustLink.href,
                useFixtures: Boolean(options.fixtures),
                cacheDir: join(runDir, 'html-cache'),
              });
              if (trust.status >= 200 && trust.status < 400 && trust.html) {
                checkpoint.pages_fetched += 1;
                hit =
                  detectSoc2OnPage({ html: trust.html, url: trustLink.href, method: 'trust_page' }) ?? hit;
              }
              if (!options.fixtures && !trust.fromCache) await sleepWithJitter(500);
            }
          }
        }
        if (!options.fixtures && !home.fromCache) await sleepWithJitter(500);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[soc2 ${i + 1}/${rows.length}] fetch failed ${homeUrl}: ${message}`);
        if (!options.fixtures) await sleepWithJitter(500);
      }

      if (hit.has_soc2 !== 'yes' && willSearch) {
        const query = `site:${domain} ("SOC 2" OR SOC2 OR "trust center")`;
        try {
          const json = await serperSearch(query, {
            useFixtures: Boolean(options.fixtures),
            onCall: () => {
              checkpoint.serper_calls += 1;
            },
          });
          const serperHit = detectSoc2FromSerper({
            domain,
            results: [
              ...(json.knowledgeGraph?.website
                ? [{ title: json.knowledgeGraph.title, link: json.knowledgeGraph.website, snippet: json.knowledgeGraph.description }]
                : []),
              ...(json.organic ?? []),
            ],
          });
          if (serperHit) hit = serperHit;
          else if (homepageOk) hit = emptySoc2('no');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[soc2 ${i + 1}/${rows.length}] serper failed: ${message}`);
          if (/Not enough credits/i.test(message)) {
            writeJson(checkpointPath, checkpoint);
            throw new Error(
              `Serper out of credits at ${i + 1}/${rows.length}. Checkpoint saved. Top up and re-run with --retry-unknown --live.`,
            );
          }
        }
        if (!options.fixtures) await sleep(150);
      } else if (hit.has_soc2 !== 'yes' && homepageOk && !willSearch) {
        hit = emptySoc2('unknown');
      }
    }

    const updated = rowToRecord({
      ...row,
      has_soc2: hit.has_soc2,
      soc2_evidence_url: hit.soc2_evidence_url,
      soc2_evidence_snippet: hit.soc2_evidence_snippet,
      soc2_method: hit.soc2_method,
    });
    checkpoint.results.push(updated);
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    if (fullRows) {
      const idx = fullRows.findIndex((r) => r.company_key === updated.company_key);
      if (idx >= 0) fullRows[idx] = { ...fullRows[idx], ...updated };
      writeCsv(outPath, fullRows, SOC2_COLUMNS);
    } else {
      writeCsv(outPath, checkpoint.results, SOC2_COLUMNS);
    }
  }

  const tallyRows = fullRows ?? checkpoint.results;
  writeJson(join(runDir, 'soc2_tally.json'), {
    serper_calls: checkpoint.serper_calls,
    pages_fetched: checkpoint.pages_fetched,
    yes: tallyRows.filter((r) => r.has_soc2 === 'yes').length,
    no: tallyRows.filter((r) => r.has_soc2 === 'no').length,
    unknown: tallyRows.filter((r) => r.has_soc2 === 'unknown').length,
    retry_unknown: Boolean(options.retryUnknown),
  });
  console.log(
    JSON.stringify(
      {
        done: true,
        serper_calls: checkpoint.serper_calls,
        yes: tallyRows.filter((r) => r.has_soc2 === 'yes').length,
        no: tallyRows.filter((r) => r.has_soc2 === 'no').length,
        unknown: tallyRows.filter((r) => r.has_soc2 === 'unknown').length,
      },
      null,
      2,
    ),
  );
  return { path: outPath };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  if (!cli.runDir && !cli.dryRun) throw new Error('--run-dir is required for soc2');
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  await enrichSoc2({
    runDir,
    dryRun: cli.dryRun,
    live: cli.live,
    fixtures: cli.fixtures,
    maxRows: cli.maxRows,
    retryUnknown: cli.retryUnknown,
  });
}

if (process.argv[1]?.includes('enrich-soc2.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
