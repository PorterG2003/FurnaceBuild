import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDirectoriesConfig, loadPlatformHosts } from '../lib/config.js';
import { loadEnv, packageRoot, fixturesDir, useFixtures } from '../lib/env.js';
import { parseCliArgs, createRunDir, truncateRows } from '../lib/cli.js';
import { writeCsv, rowToRecord, readCsv, mergeDirectoryRows } from '../lib/csv.js';
import { fetchPage } from '../lib/http.js';
import { dumpNbccAceps } from './nbccBrowser.js';
import { sleepWithJitter } from '../lib/retry.js';
import { DIRECTORY_COLUMNS, type DirectoryEntry } from '../lib/types.js';
import { hostnameOf } from '../lib/url.js';
import { aswbJsonStats, nasbaPagePlan, acpePagePlan, parseDirectoryHtml, nextPageUrls } from './parse.js';

export type DirectoryCoverage = {
  id: string;
  skipped?: string;
  pages?: number;
  parsed?: number;
  with_website?: number;
  site_results?: number | null;
  api_rows?: number;
  skipped_individual_course?: number;
  by_status?: Record<string, number>;
  complete?: boolean;
  note?: string;
};

export async function ingestDirectories(options: {
  runDir?: string;
  fixtures?: boolean;
  directory?: string;
  maxRows?: number | null;
  maxPages?: number | null;
} = {}): Promise<{ runDir: string; rows: DirectoryEntry[]; coverage: DirectoryCoverage[] }> {
  loadEnv();
  const cli = parseCliArgs();
  const config = loadDirectoriesConfig();
  const fixtures = options.fixtures ?? cli.fixtures ?? useFixtures();
  const runDir = resolve(options.runDir ?? cli.runDir ?? join(packageRoot, createRunDir()));
  mkdirSync(runDir, { recursive: true });

  const selected = config.directories.filter((d) => {
    const id = options.directory ?? cli.directory;
    if (id) return d.id === id;
    if (fixtures) return true;
    return d.enabled !== false;
  });
  const maxPages = options.maxPages ?? cli.maxPages ?? config.fetch.max_pages_per_directory;
  const all: DirectoryEntry[] = [];
  const coverage: DirectoryCoverage[] = [];

  for (const dir of selected) {
    const ctx = {
      source_directory: dir.id,
      accreditor: dir.accreditor,
      audience_profession: dir.audience_profession,
      source_url: dir.start_url,
    };

    if (fixtures) {
      const fixturePath = join(fixturesDir, 'directories', `${dir.id}.html`);
      if (!existsSync(fixturePath)) continue;
      const html = readFileSync(fixturePath, 'utf8');
      const parsed = parseDirectoryHtml(dir.id, html, ctx);
      console.error(`[${dir.id}] fixtures ${parsed.length} entries`);
      all.push(...parsed);
      coverage.push({ id: dir.id, pages: 1, parsed: parsed.length, with_website: parsed.filter((r) => r.listed_website).length });
      continue;
    }

    if (dir.live_parse === false) {
      console.error(`[${dir.id}] skip live (no list dump; fixtures only)`);
      coverage.push({ id: dir.id, skipped: 'live_parse=false' });
      continue;
    }

    if (dir.browser) {
      const dirCov: DirectoryCoverage = { id: dir.id, pages: 0, parsed: 0 };
      try {
        const dump = await dumpNbccAceps({
          runDir,
          startUrl: dir.start_url,
          headless: cli.headless,
        });
        const parsedJson = dump.jsonText
          ? parseDirectoryHtml(dir.id, dump.jsonText, { ...ctx, source_url: dir.start_url })
          : [];
        const parsedHtml = dump.html
          ? parseDirectoryHtml(dir.id, dump.html, { ...ctx, source_url: dir.start_url })
          : [];
        const fromDump = dump.rows.map((row) => ({
          provider_name: row.provider_name,
          source_directory: dir.id,
          accreditor: dir.accreditor,
          audience_profession: dir.audience_profession,
          source_url: dir.start_url,
          listed_website: row.website,
        }));
        const parsed = dedupe([...parsedJson, ...parsedHtml, ...fromDump]);
        all.push(...parsed);
        dirCov.pages = 1;
        dirCov.parsed = parsed.length;
        dirCov.note = `browser tactic=${dump.tactic} iris=${dump.irisFound}`;
        console.error(`[${dir.id}] browser tactic=${dump.tactic} entries=${parsed.length} iris=${dump.irisFound}`);
        writeFileSync(
          join(runDir, 'nbcc_exhaustion.json'),
          `${JSON.stringify(
            {
              generated_at: new Date().toISOString(),
              parsed: parsed.length,
              done: parsed.length >= 50 && dump.irisFound,
              tactic: dump.tactic,
              iris: dump.irisFound,
              screenshot: dump.screenshotPath ?? null,
            },
            null,
            2,
          )}\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dirCov.note = `browser fetch failed: ${message}`;
        console.error(`[${dir.id}] browser fetch failed: ${message}`);
      }
      coverage.push(dirCov);
      continue;
    }

    const dirCov: DirectoryCoverage = { id: dir.id, pages: 0, parsed: 0 };
    try {
      const seenPages = new Set<string>();
      const queue: string[] = [];
      if (dir.json_url) queue.push(dir.json_url);
      if (!dir.json_url || dir.fetch_start_with_json) {
        if (!queue.includes(dir.start_url)) queue.push(dir.start_url);
      }
      for (const extra of dir.extra_urls ?? []) {
        if (!queue.includes(extra)) queue.push(extra);
      }
      let pages = 0;
      let parsedCount = 0;
      while (queue.length > 0 && pages < (maxPages ?? 50)) {
        const url = queue.shift()!;
        if (seenPages.has(url)) continue;
        seenPages.add(url);
        pages += 1;
        const jsonPost = Boolean(dir.json_url && dir.json_method === 'POST' && url === dir.json_url);
        const page = await fetchPage({
          url,
          cacheDir: join(runDir, 'html-cache'),
          timeoutMs: config.fetch.timeout_ms,
          userAgent: config.fetch.user_agent,
          method: jsonPost ? 'POST' : 'GET',
          body: jsonPost ? dir.json_body ?? 'draw=1&start=0&length=5000' : undefined,
          headers: jsonPost
            ? { Referer: dir.start_url, 'X-Requested-With': 'XMLHttpRequest' }
            : undefined,
        });
        if (dir.id === 'aswb') {
          const stats = aswbJsonStats(page.html);
          dirCov.api_rows = stats.apiRows;
          dirCov.skipped_individual_course = stats.skippedIndividualCourse;
          dirCov.by_status = stats.byStatus;
        }
        if (dir.id === 'nasba' && pages === 1) {
          const plan = nasbaPagePlan(page.html, dir.start_url);
          dirCov.site_results = plan.totalResults;
          for (const next of plan.pageUrls) {
            const pageNo = new URL(next).searchParams.get('page');
            if (pageNo === '1') continue;
            if (!seenPages.has(next)) queue.push(next);
          }
        } else if (dir.id === 'acpe' && /program-lookup/i.test(url) && !/wp-json/i.test(url)) {
          const plan = acpePagePlan(page.html, url);
          if (plan.totalResults && !/\/page\/\d+/.test(url)) {
            dirCov.site_results = (dirCov.site_results ?? 0) + plan.totalResults;
          }
          for (const next of plan.pageUrls) {
            if (!seenPages.has(next)) queue.push(next);
          }
        } else if (!dir.json_url && dir.id !== 'nasba' && dir.follow_pagination !== false) {
          for (const next of nextPageUrls(page.html, url)) {
            if (!seenPages.has(next)) queue.push(next);
          }
        }
        const parsed = parseDirectoryHtml(dir.id, page.html, { ...ctx, source_url: url });
        parsedCount += parsed.length;
        all.push(...parsed);
        await sleepWithJitter(config.fetch.rate_ms);
      }
      dirCov.pages = pages;
      dirCov.parsed = parsedCount;
      console.error(`[${dir.id}] pages=${pages} entries=${parsedCount} status_ok`);
      if (dir.id === 'nbcc') {
        writeFileSync(
          join(runDir, 'nbcc_exhaustion.json'),
          `${JSON.stringify(
            {
              generated_at: new Date().toISOString(),
              parsed: parsedCount,
              done: parsedCount >= 50,
              paths: [
                { url: 'https://search.nbcc.org/Search/ACEP', result: 'NXDOMAIN' },
                { url: 'https://nbcc.org/search/acep_by_state?statecode=OH', result: 'HTTP 404' },
                { url: 'https://www.nbcc.org/search/acepdirectory', result: 'Blazor Connection Interrupted; All ACEPs no-op' },
                { url: 'https://courses.nbcc.org/', result: 'NXDOMAIN' },
                { url: 'https://web.archive.org/cdx/.../Search/ACEP', result: 'empty CDX; playback 503' },
                { url: 'https://www.nbcc.org/Assets/ACEP/ACEPDirectory.pdf', result: 'HTTP 404' },
              ],
            },
            null,
            2,
          )}\n`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dirCov.note = `fetch failed: ${message}`;
      console.error(`[${dir.id}] fetch failed: ${message}`);
      if (dir.id === 'nbcc') {
        writeFileSync(
          join(runDir, 'nbcc_exhaustion.json'),
          `${JSON.stringify({ generated_at: new Date().toISOString(), parsed: 0, done: false, fetch_failed: message }, null, 2)}\n`,
        );
      }
    }
    coverage.push(dirCov);
  }

  const directoryFilter = options.directory ?? cli.directory;
  if (!directoryFilter || directoryFilter === 'ce_platform') {
    const seeded = seedPlatformHosts();
    all.push(...seeded);
    coverage.push({
      id: 'ce_platform',
      pages: 0,
      parsed: seeded.length,
      with_website: seeded.filter((r) => r.listed_website).length,
      complete: true,
      note: 'seeded platform companies (not manufacturer indexes)',
    });
  }

  let rows = dedupe(all).map((row) =>
    isDirectoryOwnedWebsite(row) ? { ...row, listed_website: '' } : row,
  );
  const maxRows = options.maxRows ?? cli.maxRows;
  if (maxRows) {
    rows = roundRobinByDirectory(rows);
    rows = truncateRows(rows, maxRows);
  }

  for (const dirCov of coverage) {
    const written = rows.filter((r) => r.source_directory === dirCov.id);
    dirCov.with_website = written.filter((r) => r.listed_website).length;
    if (dirCov.id === 'nasba' && dirCov.site_results) {
      dirCov.complete = (dirCov.parsed ?? 0) >= dirCov.site_results * 0.98;
      if (!dirCov.complete) {
        dirCov.note = `parsed ${dirCov.parsed} vs site ${dirCov.site_results}`;
      }
    }
    if (dirCov.id === 'aswb' && dirCov.api_rows) {
      const accounted = (dirCov.parsed ?? 0) + (dirCov.skipped_individual_course ?? 0);
      dirCov.complete = Math.abs(accounted - dirCov.api_rows) <= 2;
      if (!dirCov.complete) {
        dirCov.note = `parsed ${dirCov.parsed} + skipped ${dirCov.skipped_individual_course} vs api ${dirCov.api_rows}`;
      }
    }
    if (dirCov.id === 'arcat') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 150;
      if (!dirCov.complete) dirCov.note = 'expected ~195 manufacturer rows from ces-x list';
    }
    if (dirCov.id === 'greence') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 60;
      if (!dirCov.complete) dirCov.note = 'expected ~70+ unique sponsors from Course / Webinar / Lunch & Learn lists';
    }
    if (dirCov.id === 'ronblank') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 40;
      if (!dirCov.complete) dirCov.note = 'expected ~50+ unique sponsors from Course / Webinar / Lunch & Learn lists';
    }
    if (dirCov.id === 'aecdaily') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 30;
      if (!dirCov.complete) dirCov.note = 'expected manufacturer names from featured JSON-LD + live session providers';
    }
    if (dirCov.id === 'cestrong') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 40;
      if (!dirCov.complete) dirCov.note = 'expected ~51 CE Strong partner CPT rows';
    }
    if (dirCov.id === 'bnp') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 800;
      if (!dirCov.complete) dirCov.note = 'expected ~1000 /architect/sponsors/ slugs from sitemap';
    }
    if (dirCov.id === 'apa') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 200;
      if (!dirCov.complete) dirCov.note = 'expected APA CESA sponsor table rows';
    }
    if (dirCov.id === 'aota') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 200;
      if (!dirCov.complete) dirCov.note = 'expected ~350 AOTA approved providers';
    }
    if (dirCov.id === 'acpe') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 200;
      if (!dirCov.complete) dirCov.note = 'expected ACPE CPE Providers + Joint Accredited (~250+205)';
    }
    if (dirCov.id === 'pace') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 40;
      if (!dirCov.complete) dirCov.note = 'expected PACE renewal-schedule providers';
    }
    if (dirCov.id === 'cope') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 200;
      if (!dirCov.complete) dirCov.note = 'expected COPE adminlist ajax org rows';
    }
    if (dirCov.id === 'nbcc') {
      dirCov.complete = (dirCov.parsed ?? 0) >= 50;
      if (!dirCov.complete && !dirCov.note) {
        dirCov.note = 'expected All ACEPs dump via Playwright (Iris + hundreds)';
      }
    }
  }

  const outPath = join(runDir, 'directory_entries.csv');
  const incoming = rows.map(rowToRecord);
  const existing = directoryFilter && existsSync(outPath) ? readCsv(outPath) : [];
  const merged = mergeDirectoryRows(existing, incoming, directoryFilter);
  writeCsv(outPath, merged, [...DIRECTORY_COLUMNS]);
  const coveragePath = join(runDir, 'directory_coverage.json');
  let coverageOut = coverage;
  if (directoryFilter && existsSync(coveragePath)) {
    try {
      const prev = JSON.parse(readFileSync(coveragePath, 'utf8')) as {
        directories?: DirectoryCoverage[];
      };
      const keep = (prev.directories ?? []).filter((d) => d.id !== directoryFilter);
      coverageOut = [...keep, ...coverage];
    } catch {
      coverageOut = coverage;
    }
  }
  writeFileSync(
    coveragePath,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        fixtures,
        written_rows: merged.length,
        truncated: Boolean(maxRows),
        directories: coverageOut,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(runDir, 'directory_checkpoint.json'),
    JSON.stringify({ count: merged.length, fixtures, at: new Date().toISOString() }, null, 2),
  );
  console.error(`Coverage ${coveragePath}`);
  return { runDir, rows, coverage };
}

function seedPlatformHosts(): DirectoryEntry[] {
  return loadPlatformHosts().map((host) => ({
    provider_name: host.name,
    source_directory: 'ce_platform',
    accreditor: 'CE platform host',
    audience_profession: host.audience_profession,
    source_url: host.website,
    listed_website: host.website,
  }));
}

const DIRECTORY_OWNED_HOSTS: Record<string, string[]> = {
  nbcc: ['nbcc.org', 'nbccf.org'],
  arcat: ['arcat.com'],
  nasba: ['nasbaregistry.org', 'nasba.org'],
  aswb: ['aswb.org', 'webauthor.com'],
  greence: ['greence.com'],
  ronblank: ['ronblank.com'],
  acpe: ['acpe-accredit.org'],
  cope: ['arbo.org'],
  pace: ['fclb.org', 'pacex.fclb.org'],
};

function isDirectoryOwnedWebsite(row: DirectoryEntry): boolean {
  const host = hostnameOf(row.listed_website);
  if (!host) return false;
  const suffixes = DIRECTORY_OWNED_HOSTS[row.source_directory] ?? [];
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function roundRobinByDirectory(rows: DirectoryEntry[]): DirectoryEntry[] {
  const buckets = new Map<string, DirectoryEntry[]>();
  for (const row of rows) {
    const list = buckets.get(row.source_directory) ?? [];
    list.push(row);
    buckets.set(row.source_directory, list);
  }
  const keys = [...buckets.keys()];
  const out: DirectoryEntry[] = [];
  let index = 0;
  while (out.length < rows.length) {
    let added = false;
    for (const key of keys) {
      const list = buckets.get(key) ?? [];
      if (index < list.length) {
        out.push(list[index]);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  return out;
}

function dedupe(rows: DirectoryEntry[]): DirectoryEntry[] {
  const byKey = new Map<string, DirectoryEntry>();
  for (const row of rows) {
    const key = `${row.source_directory}|${row.provider_name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    if (!existing.listed_website && row.listed_website) byKey.set(key, row);
  }
  return [...byKey.values()];
}
