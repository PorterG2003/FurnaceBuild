import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir, requireLiveForPaid } from './lib/cli.js';
import { loadEnv, packageRoot, ensureSerperEnv } from './lib/env.js';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { ensureDir, loadJson, writeJson } from './lib/io.js';
import { extractLinks, extractTitle } from './lib/html.js';
import { fetchPage } from './lib/http.js';
import { serperSearch, type SerperResponse } from './lib/serperClient.js';
import { hostnameOf, isSameHost } from './lib/url.js';
import { sleep } from './lib/retry.js';
import { extractEmailsFromHtml, pickDominantDomain, rankEmailDomains } from './extractEmails.js';
import {
  isMegaDistrictName,
  websiteQuery,
  type Lookup,
  type LookupKind,
} from './lookups.js';
import {
  candidateFromUrl,
  pickBestWebsite,
  scoreSchoolWebsite,
  type ScoredWebsite,
} from './scoreWebsite.js';
import { isVendorHost } from './vendorHosts.js';
import { LOOKUP_COLUMNS } from './prep.js';

export const LOOKUP_RESULT_COLUMNS = [
  ...LOOKUP_COLUMNS,
  'serper_query',
  'website_url',
  'website_host',
  'website_title',
  'website_kind',
  'extracted_emails',
  'email_domains',
  'chosen_domain',
  'confidence',
  'notes',
] as const;

export type LookupResult = {
  lookup_key: string;
  kind: LookupKind;
  name: string;
  city: string;
  state: string;
  mega: boolean;
  serper_query: string;
  website_url: string;
  website_host: string;
  website_title: string;
  website_kind: 'official' | 'vendor' | 'none';
  extracted_emails: string;
  email_domains: string;
  chosen_domain: string;
  confidence: 'high' | 'medium' | 'ask';
  notes: string;
};

type Checkpoint = {
  serper_calls: number;
  page_fetches: number;
  results: Record<string, LookupResult>;
};

function scoredFromSerper(orgName: string, json: SerperResponse): ScoredWebsite[] {
  const scored: ScoredWebsite[] = [];
  if (json.knowledgeGraph?.website) {
    const c = candidateFromUrl(json.knowledgeGraph.website, {
      source: 'knowledge_graph',
      title: json.knowledgeGraph.title,
      snippet: json.knowledgeGraph.description,
    });
    if (c) scored.push(scoreSchoolWebsite(orgName, c));
  }
  for (const org of json.organic ?? []) {
    if (!org.link) continue;
    const c = candidateFromUrl(org.link, {
      source: 'organic',
      position: org.position,
      title: org.title,
      snippet: org.snippet,
    });
    if (c) scored.push(scoreSchoolWebsite(orgName, c));
  }
  return scored;
}

function contactScore(href: string, text: string): number {
  const hay = `${href} ${text}`.toLowerCase();
  if (/facebook|twitter|instagram|youtube|linkedin|mailto:/.test(hay)) return 0;
  let score = 0;
  if (/staff.?director|directory|our.?staff/.test(hay)) score += 3;
  if (/\bcontact\b/.test(hay)) score += 2;
  if (/faculty|administration/.test(hay)) score += 2;
  if (/\babout\b/.test(hay)) score += 1;
  return score;
}

export function decideResult(options: {
  lookup: Lookup;
  query: string;
  best: ScoredWebsite | null;
  websiteUrl: string;
  websiteTitle: string;
  emails: string[];
  extraNotes: string[];
}): LookupResult {
  const notes = [...options.extraNotes];
  const ranked = rankEmailDomains(options.emails);
  const picked = pickDominantDomain(ranked);
  notes.push(...picked.notes);

  const websiteHost = hostnameOf(options.websiteUrl);
  const vendor = Boolean(options.best?.vendor || (websiteHost && isVendorHost(websiteHost)));
  const mega =
    options.lookup.mega ||
    isMegaDistrictName(options.lookup.name);

  let chosen = picked.domain;
  let confidence: LookupResult['confidence'] = 'ask';
  let websiteKind: LookupResult['website_kind'] = 'none';

  if (options.websiteUrl) {
    websiteKind = vendor ? 'vendor' : 'official';
  }

  if (mega) notes.push('mega_district');

  if (picked.domain && !picked.competing) {
    chosen = picked.domain;
    confidence = 'high';
    notes.push('emails_on_site');
  } else if (picked.domain && picked.competing) {
    chosen = picked.domain;
    confidence = 'ask';
  } else {
    if (!options.websiteUrl) notes.push('no_official_website');
    if (vendor && !picked.domain) notes.push('vendor_cms_no_emails');
    if (websiteHost) notes.push(`website_domain_only:${websiteHost}`);
    chosen = '';
    confidence = 'ask';
  }

  return {
    lookup_key: options.lookup.lookup_key,
    kind: options.lookup.kind,
    name: options.lookup.name,
    city: options.lookup.city,
    state: options.lookup.state,
    mega,
    serper_query: options.query,
    website_url: options.websiteUrl,
    website_host: websiteHost,
    website_title: options.websiteTitle,
    website_kind: websiteKind,
    extracted_emails: options.emails.join('|'),
    email_domains: ranked.map((r) => r.domain).join('|'),
    chosen_domain: chosen,
    confidence,
    notes: notes.filter(Boolean).join('; '),
  };
}

async function resolveOneLookup(
  lookup: Lookup,
  options: {
    fixtures: boolean;
    cacheDir: string;
    onSerper: () => void;
    onFetch: () => void;
  },
): Promise<LookupResult> {
  const query = websiteQuery(lookup);
  const extraNotes: string[] = [];
  let json: SerperResponse;
  try {
    json = await serperSearch(query, {
      useFixtures: options.fixtures,
      onCall: options.onSerper,
    });
  } catch (error) {
    extraNotes.push(`serper_error:${error instanceof Error ? error.message : String(error)}`);
    return decideResult({
      lookup,
      query,
      best: null,
      websiteUrl: '',
      websiteTitle: '',
      emails: [],
      extraNotes,
    });
  }

  const best = pickBestWebsite(scoredFromSerper(lookup.name, json));
  if (!best) {
    return decideResult({
      lookup,
      query,
      best: null,
      websiteUrl: '',
      websiteTitle: '',
      emails: [],
      extraNotes,
    });
  }

  const emails = new Set<string>();
  let websiteUrl = best.url;
  let websiteTitle = best.title ?? '';

  try {
    options.onFetch();
    const home = await fetchPage({
      url: best.url,
      useFixtures: options.fixtures,
      cacheDir: options.fixtures ? undefined : options.cacheDir,
    });
    websiteUrl = home.finalUrl || best.url;
    if (home.status >= 400 || !home.html) {
      extraNotes.push(`homepage_http_${home.status}`);
    } else {
      websiteTitle = extractTitle(home.html) || websiteTitle;
      for (const email of extractEmailsFromHtml(home.html)) emails.add(email);

      const contactLinks = extractLinks(home.html, home.finalUrl)
        .map((link) => ({ ...link, score: contactScore(link.href, link.text) }))
        .filter((link) => link.score > 0 && isSameHost(link.href, home.finalUrl))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      for (const link of contactLinks) {
        if (emails.size >= 8) break;
        try {
          options.onFetch();
          const page = await fetchPage({
            url: link.href,
            useFixtures: options.fixtures,
            cacheDir: options.fixtures ? undefined : options.cacheDir,
          });
          if (page.status < 400 && page.html) {
            for (const email of extractEmailsFromHtml(page.html)) emails.add(email);
          }
        } catch (error) {
          extraNotes.push(`contact_fetch_error:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  } catch (error) {
    extraNotes.push(`homepage_error:${error instanceof Error ? error.message : String(error)}`);
  }

  return decideResult({
    lookup,
    query,
    best,
    websiteUrl,
    websiteTitle,
    emails: [...emails],
    extraNotes,
  });
}

export async function resolveLookups(options: {
  runDir: string;
  dryRun?: boolean;
  live?: boolean;
  fixtures?: boolean;
}): Promise<{ path: string; resolved: number; serperCalls: number }> {
  const runDir = ensureDir(options.runDir);
  const inputPath = join(runDir, 'lookups.csv');
  if (!existsSync(inputPath)) throw new Error(`Missing ${inputPath}. Run prep first.`);

  const rows = readCsv(inputPath);
  const lookups: Lookup[] = rows.map((row) => ({
    lookup_key: row.lookup_key,
    kind: row.kind as LookupKind,
    name: row.name,
    city: row.city ?? '',
    state: row.state ?? '',
    mega: row.mega === 'true' || row.mega === '1',
  }));

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      unique_lookups: lookups.length,
      estimated_serper_calls: lookups.length,
      estimated_page_fetches: lookups.length * 3,
      estimated_serper_usd: Number((lookups.length * 0.001).toFixed(3)),
      note: 'Serper only (~$0.001/search). Homepage/contact fetches are free. Confirm with --live.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'resolve_dry_run.json'), estimate);
    return { path: join(runDir, 'lookup_results.csv'), resolved: 0, serperCalls: 0 };
  }

  requireLiveForPaid({
    live: Boolean(options.live),
    dryRun: false,
    fixtures: Boolean(options.fixtures),
    vendor: 'Serper',
  });

  if (!options.fixtures) {
    await ensureSerperEnv();
    if (!process.env.SERPER_API_KEY?.trim()) {
      throw new Error('SERPER_API_KEY is required for live search');
    }
  }

  const outPath = join(runDir, 'lookup_results.csv');
  const checkpointPath = join(runDir, 'resolve_checkpoint.json');
  const cacheDir = join(runDir, 'page-cache');
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    serper_calls: 0,
    page_fetches: 0,
    results: {},
  };

  for (let i = 0; i < lookups.length; i++) {
    const lookup = lookups[i]!;
    if (checkpoint.results[lookup.lookup_key]) {
      console.error(`[resolve ${i + 1}/${lookups.length}] skip cached ${lookup.name}`);
      continue;
    }
    console.error(`[resolve ${i + 1}/${lookups.length}] ${lookup.kind} ${lookup.name}`);
    const result = await resolveOneLookup(lookup, {
      fixtures: Boolean(options.fixtures),
      cacheDir,
      onSerper: () => {
        checkpoint.serper_calls += 1;
      },
      onFetch: () => {
        checkpoint.page_fetches += 1;
      },
    });
    checkpoint.results[lookup.lookup_key] = result;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, Object.values(checkpoint.results).map((r) => rowToRecord(r)), LOOKUP_RESULT_COLUMNS);
    if (!options.fixtures) await sleep(150);
  }

  const results = lookups.map((l) => checkpoint.results[l.lookup_key]!).filter(Boolean);
  writeCsv(outPath, results.map((r) => rowToRecord(r)), LOOKUP_RESULT_COLUMNS);
  writeJson(join(runDir, 'resolve_tally.json'), {
    serper_calls: checkpoint.serper_calls,
    page_fetches: checkpoint.page_fetches,
    lookups: results.length,
    high: results.filter((r) => r.confidence === 'high').length,
    medium: results.filter((r) => r.confidence === 'medium').length,
    ask: results.filter((r) => r.confidence === 'ask').length,
    with_domain: results.filter((r) => r.chosen_domain).length,
  });
  console.log(
    JSON.stringify(
      {
        done: true,
        serper_calls: checkpoint.serper_calls,
        page_fetches: checkpoint.page_fetches,
        with_domain: results.filter((r) => r.chosen_domain).length,
        ask: results.filter((r) => r.confidence === 'ask').length,
      },
      null,
      2,
    ),
  );
  return { path: outPath, resolved: results.length, serperCalls: checkpoint.serper_calls };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  await resolveLookups({
    runDir,
    dryRun: cli.dryRun,
    live: cli.live,
    fixtures: cli.fixtures,
  });
}

if (process.argv[1]?.includes('resolve.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
