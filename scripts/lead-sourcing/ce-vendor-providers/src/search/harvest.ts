import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadQueriesConfig, loadDirectoriesConfig, loadAliasesConfig } from '../lib/config.js';
import { loadEnv, ensureSerperEnv, packageRoot, useFixtures } from '../lib/env.js';
import { parseCliArgs, createRunDir, requireLiveForSerper, truncateRows } from '../lib/cli.js';
import { writeCsv, rowToRecord, readCsv } from '../lib/csv.js';
import { fetchPage } from '../lib/http.js';
import { extractTitle, htmlToText } from '../lib/html.js';
import { canonicalizeUrl } from '../lib/url.js';
import { UNMATCHED_COLUMNS, type ExtractedActivity, type SearchHit } from '../lib/types.js';
import { detectIsFree } from '../fit/isFree.js';
import { detectRegistration } from '../fit/registrationHost.js';
import { detectFormalGrantProgram } from '../fit/grantProgram.js';
import { detectCeFormatFromHtml } from '../fit/ceFormat.js';
import { extractGrant, extractHost, splitSponsorString, normalizeSponsorKey } from '../fit/extract.js';
import { classifyFromHtml } from '../classify/heuristics.js';
import { buildSearchQueries, estimateSerperCredits } from './queries.js';
import { serperSearchAllPages } from './serperClient.js';
import { YieldStopTracker } from './yieldStop.js';

export async function harvestSearch(options: {
  runDir?: string;
  mode?: 'host' | 'grant';
  fixtures?: boolean;
  dryRun?: boolean;
  live?: boolean;
  maxQueries?: number | null;
  maxPages?: number | null;
  wave?: number;
} = {}): Promise<{ runDir: string; activities: ExtractedActivity[]; unmatched: Record<string, string>[] }> {
  loadEnv();
  const cli = parseCliArgs();
  const mode = options.mode ?? cli.mode ?? 'host';
  const fixtures = options.fixtures ?? cli.fixtures ?? useFixtures();
  const dryRun = options.dryRun ?? cli.dryRun;
  const live = options.live ?? cli.live;
  requireLiveForSerper({ live, dryRun, fixtures });

  const queriesConfig = loadQueriesConfig();
  const dirConfig = loadDirectoriesConfig();
  const aliases = loadAliasesConfig();
  const queries = truncateRows(
    buildSearchQueries(queriesConfig, mode, options.wave ?? cli.wave),
    options.maxQueries ?? cli.maxQueries,
  );
  const pagesPerQuery = options.maxPages ?? cli.maxPages ?? 2;
  const estimate = estimateSerperCredits(queries.length, pagesPerQuery);

  const runDir = resolve(options.runDir ?? cli.runDir ?? join(packageRoot, createRunDir()));
  mkdirSync(runDir, { recursive: true });

  writeFileSync(
    join(runDir, `${mode}_query_plan.json`),
    JSON.stringify({ mode, queries, estimate, dryRun, fixtures, live }, null, 2),
  );

  if (dryRun && !fixtures) {
    console.error(
      `[dry-run] ${mode} search: ${estimate.queries} queries × ${estimate.pagesPerQuery} pages ≈ ${estimate.credits} Serper credits (~$${estimate.dollars}). Pass --live after spend OK.`,
    );
    return { runDir, activities: [], unmatched: [] };
  }

  if (!fixtures) {
    await ensureSerperEnv();
  }

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  const queryLog: Array<Record<string, unknown>> = [];

  for (const query of queries) {
    const tracker = new YieldStopTracker(queriesConfig.yield_stop);
    let truncated = false;
    await serperSearchAllPages({
      query,
      useFixtures: fixtures,
      pageCap: pagesPerQuery,
      rateLimitMs: queriesConfig.serper_rate_ms,
      onPage: (page, response) => {
        const organic = response.organic ?? [];
        if (organic.length >= 10) truncated = true;
        let newUrls = 0;
        for (const item of organic) {
          if (!item.link) continue;
          const url = canonicalizeUrl(item.link);
          if (seen.has(url)) continue;
          seen.add(url);
          newUrls += 1;
          hits.push({
            url,
            title: item.title ?? '',
            snippet: item.snippet ?? '',
            search_query: query,
            serp_page: page,
            collected_at: new Date().toISOString(),
          });
        }
        const action = tracker.recordPage(newUrls);
        queryLog.push({ query, page, organic: organic.length, newUrls, action, truncated: organic.length >= 10 });
        if (action !== 'continue') {
          /* yield stop handled by shouldStop via closure would need mutable flag; we just log */
        }
      },
    });
    void truncated;
  }

  writeFileSync(join(runDir, `${mode}_serp_log.json`), JSON.stringify(queryLog, null, 2));

  const activities: ExtractedActivity[] = [];
  const unmatched: Record<string, string>[] = [];

  for (const hit of hits) {
    const page = await fetchPage({
      url: hit.url,
      useFixtures: fixtures,
      cacheDir: join(runDir, 'html-cache'),
      timeoutMs: dirConfig.fetch.timeout_ms,
      userAgent: dirConfig.fetch.user_agent,
    });
    if (page.loginWall) {
      unmatched.push({ url: hit.url, title: hit.title, snippet: hit.snippet, search_query: hit.search_query, reason: 'login_wall' });
      continue;
    }
    if (!page.html) {
      unmatched.push({ url: hit.url, title: hit.title, snippet: hit.snippet, search_query: hit.search_query, reason: 'fetch_failed' });
      continue;
    }

    const text = htmlToText(page.html);
    const title = extractTitle(page.html) || hit.title;
    const registration = detectRegistration(page.html, hit.url, hit.url);
    const classified = classifyFromHtml(title, page.html, title);
    const format = detectCeFormatFromHtml(page.html, hit.snippet);

    if (mode === 'host') {
      const extracted = extractHost(`${hit.snippet} ${text}`);
      if (!extracted || extracted.coiRejected) {
        unmatched.push({
          url: hit.url,
          title,
          snippet: extracted?.snippet || hit.snippet,
          search_query: hit.search_query,
          reason: extracted?.coiRejected ? 'faculty_coi' : 'no_host_extract',
        });
        continue;
      }
      activities.push({
        company_name: extracted.host,
        source_kind: 'host_search',
        source_url: hit.url,
        page_title: title,
        extract_snippet: extracted.snippet,
        registration_url: registration.registration_url,
        registration_host_domain: registration.registration_host_domain,
        is_free: detectIsFree(text),
        has_formal_grant_program: detectFormalGrantProgram(text),
        ce_formats: format.ce_formats_csv,
        primary_ce_format: format.primary_ce_format,
        has_live_online: format.has_live_online,
        audience_profession: '',
        audience_relationship: classified.audience_relationship,
        entity_class: classified.entity_class,
        self_provided: classified.entity_class === 'commercial_vendor',
        needs_review: classified.entity_class === 'unknown',
        fetched_at: new Date().toISOString(),
      });
    } else {
      const extracted = extractGrant(`${hit.snippet} ${text}`);
      if (!extracted || extracted.coiRejected) {
        unmatched.push({
          url: hit.url,
          title,
          snippet: extracted?.snippet || hit.snippet,
          search_query: hit.search_query,
          reason: extracted?.coiRejected ? 'faculty_coi' : 'no_grant_extract',
        });
        continue;
      }
      const split = splitSponsorString(extracted.sponsorsRaw);
      for (const name of split.names) {
        const key = normalizeSponsorKey(name, aliases.merges);
        const display = aliases.merges[key] ?? name;
        const isPharma = aliases.known_pharma.some((p) => p.toLowerCase() === display.toLowerCase() || key.includes(p.toLowerCase()));
        activities.push({
          company_name: display,
          source_kind: 'grant_search',
          source_url: hit.url,
          page_title: title,
          extract_snippet: extracted.snippet,
          registration_url: registration.registration_url,
          registration_host_domain: registration.registration_host_domain,
          is_free: detectIsFree(text),
          has_formal_grant_program: detectFormalGrantProgram(text) || isPharma,
          ce_formats: format.ce_formats_csv,
          primary_ce_format: format.primary_ce_format,
          has_live_online: format.has_live_online,
          audience_profession: '',
          audience_relationship: 'unknown',
          entity_class: 'commercial_vendor',
          self_provided: false,
          needs_review: split.needs_review,
          fetched_at: new Date().toISOString(),
        });
      }
    }
  }

  const outName = mode === 'host' ? 'host_activities.csv' : 'grant_activities.csv';
  writeCsv(
    join(runDir, outName),
    activities.map((a) => rowToRecord(a)),
    [
      'company_name',
      'source_kind',
      'source_url',
      'page_title',
      'extract_snippet',
      'registration_url',
      'registration_host_domain',
      'is_free',
      'has_formal_grant_program',
      'ce_formats',
      'primary_ce_format',
      'has_live_online',
      'audience_profession',
      'audience_relationship',
      'entity_class',
      'self_provided',
      'needs_review',
      'fetched_at',
    ],
  );
  const unmatchedPath = join(runDir, 'unmatched.csv');
  const existing = existsSync(unmatchedPath) ? readCsv(unmatchedPath) : [];
  writeCsv(unmatchedPath, [...existing, ...unmatched], [...UNMATCHED_COLUMNS]);
  return { runDir, activities, unmatched };
}
