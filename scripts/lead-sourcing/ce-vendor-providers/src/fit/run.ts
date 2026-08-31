import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDirectoriesConfig } from '../lib/config.js';
import { loadEnv } from '../lib/env.js';
import { parseCliArgs, truncateRows } from '../lib/cli.js';
import { readCsv, writeCsv, rowToRecord, mergeDirectoryRows } from '../lib/csv.js';
import { fetchPage, hasCachedPage } from '../lib/http.js';
import { extractLinks, extractTitle, htmlToText } from '../lib/html.js';
import { HostGate, mapWithConcurrency } from '../lib/pool.js';
import { isFetchableUrl } from '../lib/url.js';
import { classifyFromHtml } from '../classify/heuristics.js';
import { FIT_COLUMNS, type ClassifiedEntry, type FitRecord } from '../lib/types.js';
import { detectIsFree } from './isFree.js';
import { detectRegistration } from './registrationHost.js';
import { detectFormalGrantProgram } from './grantProgram.js';
import { detectCeFormatFromHtml, mergeCeFormats } from './ceFormat.js';

const CE_LINK_HINT =
  /\b(ce|ceu|cpe|pdh|continuing education|webinar|lunch and learn|courses?|trainings?|workshops?|upcoming)\b/i;

export async function resolveFit(options: {
  runDir?: string;
  fixtures?: boolean;
  maxRows?: number | null;
  directory?: string;
  concurrency?: number;
} = {}): Promise<{ runDir: string; rows: FitRecord[] }> {
  loadEnv();
  const cli = parseCliArgs();
  const config = loadDirectoriesConfig();
  const fixtures = options.fixtures ?? cli.fixtures ?? false;
  const directory = options.directory ?? cli.directory;
  const concurrency = options.concurrency ?? cli.concurrency;
  const runDir = resolve(options.runDir ?? cli.runDir ?? '');
  if (!runDir) throw new Error('--run-dir is required for fit');
  const inputPath = join(runDir, 'classified_entries.csv');
  if (!existsSync(inputPath)) throw new Error(`Missing ${inputPath}. Run classify first.`);

  let raw = readCsv(inputPath);
  if (directory) raw = raw.filter((row) => row.source_directory === directory);
  raw = truncateRows(raw, options.maxRows ?? cli.maxRows);
  const cacheDir = join(runDir, 'html-cache');
  const hostGate = fixtures ? undefined : new HostGate(config.fetch.rate_ms);

  const rows = await mapWithConcurrency(raw, fixtures ? raw.length || 1 : concurrency, async (rec, index) => {
    const entry = rec as unknown as ClassifiedEntry;
    const homepageUrl = entry.homepage_url || entry.listed_website;
    let ceUrl = homepageUrl;
    let homeHtml = '';
    let html = '';
    const skipLive =
      !fixtures &&
      (entry.entity_class === 'society' ||
        entry.entity_class === 'institution' ||
        entry.source_directory === 'cope');
    const canFetch = isFetchableUrl(homepageUrl);
    const useCacheOnly = skipLive && !hasCachedPage(cacheDir, homepageUrl);

    if (canFetch && !useCacheOnly) {
      try {
        const home = await fetchPage({
          url: homepageUrl,
          useFixtures: fixtures,
          cacheDir,
          timeoutMs: config.fetch.timeout_ms,
          userAgent: config.fetch.user_agent,
          hostGate,
        });
        homeHtml = home.html;
        html = home.html;
        const followCe = !skipLive;
        const ceLink = followCe
          ? extractLinks(home.html, homepageUrl).find(
              (l) => CE_LINK_HINT.test(l.href) || CE_LINK_HINT.test(l.text),
            )
          : undefined;
        ceUrl = ceLink?.href || homepageUrl;
        if (followCe && ceUrl !== homepageUrl && isFetchableUrl(ceUrl)) {
          const cePage = await fetchPage({
            url: ceUrl,
            useFixtures: fixtures,
            cacheDir,
            timeoutMs: config.fetch.timeout_ms,
            userAgent: config.fetch.user_agent,
            hostGate,
          });
          html = cePage.html;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[fit ${index + 1}/${raw.length}] fetch failed ${homepageUrl}: ${message}`);
      }
    }

    const text = htmlToText(html);
    const pageClass = classifyFromHtml(entry.provider_name, html, extractTitle(html), {
      source_directory: entry.source_directory,
      page_url: ceUrl || homepageUrl,
    });
    const registration = detectRegistration(html, ceUrl, homepageUrl);
    const isFree = detectIsFree(text);
    const homeFormat = detectCeFormatFromHtml(homeHtml);
    const ceFormat = detectCeFormatFromHtml(html);
    const format =
      homeHtml && html && homeHtml !== html
        ? mergeCeFormats([
            { ce_formats: homeFormat.ce_formats_csv, has_live_online: homeFormat.has_live_online },
            { ce_formats: ceFormat.ce_formats_csv, has_live_online: ceFormat.has_live_online },
          ])
        : ceFormat;
    const grant =
      detectFormalGrantProgram(text) ||
      String(entry.has_formal_grant_program) === 'true' ||
      pageClass.has_formal_grant_program;

    const selfProvided = entry.entity_class === 'commercial_vendor';
    const needsReview =
      entry.entity_class === 'unknown' ||
      registration.registration_kind === 'unknown' ||
      format.primary_ce_format === 'unknown';
    const relationship =
      entry.audience_relationship && entry.audience_relationship !== 'unknown'
        ? entry.audience_relationship
        : pageClass.audience_relationship;

    console.error(
      `[fit ${index + 1}/${raw.length}] ${entry.provider_name} → ${registration.registration_kind} free=${isFree} format=${format.ce_formats_csv || 'unknown'}`,
    );
    const row: FitRecord = {
      ...entry,
      entity_class: entry.entity_class,
      company_sells_what: entry.company_sells_what || pageClass.company_sells_what,
      registration_host_domain: registration.registration_host_domain,
      registration_kind: registration.registration_kind,
      registration_url: registration.registration_url,
      is_free: isFree,
      self_provided: selfProvided,
      audience_relationship: relationship,
      has_formal_grant_program: grant,
      ce_page_url: ceUrl,
      activity_title: extractTitle(html),
      ce_formats: format.ce_formats_csv,
      primary_ce_format: format.primary_ce_format,
      has_live_online: format.has_live_online,
      needs_review: needsReview,
      source_kind: 'directory',
    };
    return row;
  });

  const outPath = join(runDir, 'fit_entries.csv');
  const existing = existsSync(outPath) ? readCsv(outPath) : [];
  const merged = mergeDirectoryRows(existing, rows.map(rowToRecord), directory);
  writeCsv(outPath, merged, [...FIT_COLUMNS]);
  writeFileSync(
    join(runDir, 'fit_coverage.json'),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        directory: directory ?? 'all',
        fit_rows: rows.length,
        registration_kind: countBy(rows, (r) => r.registration_kind),
        is_free: countBy(rows, (r) => String(r.is_free)),
        primary_ce_format: countBy(rows, (r) => r.primary_ce_format),
        has_live_online: countBy(rows, (r) => String(r.has_live_online)),
      },
      null,
      2,
    )}\n`,
  );
  return { runDir, rows };
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row) || '(empty)';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
