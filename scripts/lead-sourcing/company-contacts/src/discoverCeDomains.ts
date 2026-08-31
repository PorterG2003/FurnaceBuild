import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { isUnusableProspectHost } from '../../ce-vendor-providers/src/lib/url.js';
import {
  pickBestScored,
  scoreDomainCandidate,
  type DomainCandidate,
  type ScoredDomain,
} from '../../webinar-outreach-enrich/src/domainScore.js';
import { serperSearch } from '../../webinar-outreach-enrich/src/serperClient.js';
import { ensureEnv } from '../../webinar-outreach-enrich/src/env.js';
import { loadJson, writeJson } from '../../webinar-outreach-enrich/src/io.js';
import { normalizeDomain } from './prepCompanies.js';
import { COMPANY_COLUMNS, type CompanyRow } from './types.js';

function candidatesFromSerper(json: Awaited<ReturnType<typeof serperSearch>>): DomainCandidate[] {
  const out: DomainCandidate[] = [];
  if (json.knowledgeGraph?.website) {
    out.push({
      domain: json.knowledgeGraph.website,
      source: 'knowledge_graph',
      title: json.knowledgeGraph.title,
      snippet: json.knowledgeGraph.description,
    });
  }
  for (const org of json.organic ?? []) {
    if (!org.link) continue;
    out.push({
      domain: org.link,
      source: 'organic',
      position: org.position,
      title: org.title,
      snippet: org.snippet,
    });
  }
  return out;
}

function usableScored(companyName: string, json: Awaited<ReturnType<typeof serperSearch>>): ScoredDomain | null {
  const scored = candidatesFromSerper(json)
    .map((c) => scoreDomainCandidate(companyName, c))
    .map((s) => {
      const domain = normalizeDomain(s.domain);
      if (!domain || isUnusableProspectHost(domain)) {
        return { ...s, domain: '', score: 0, tier: 'low' as const, reasons: [...s.reasons, 'ce_platform_or_directory'] };
      }
      return { ...s, domain };
    });
  return pickBestScored(scored);
}

export type DiscoverResultRow = {
  company_name: string;
  discovered_domain: string;
  score: string;
  tier: string;
  reasons: string;
  query: string;
  status: string;
  error: string;
};

const DISCOVER_COLUMNS = [
  'company_name',
  'discovered_domain',
  'score',
  'tier',
  'reasons',
  'query',
  'status',
  'error',
];

export function serperEstimate(rowCount: number, maxRows: number | null): {
  queries: number;
  dollars: number;
} {
  const queries = maxRows != null ? Math.min(rowCount, maxRows) : rowCount;
  return { queries, dollars: Number((queries * 0.001).toFixed(3)) };
}

export async function discoverCeDomains(options: {
  runDir: string;
  dryRun?: boolean;
  live?: boolean;
  maxRows?: number | null;
  fixtures?: boolean;
}): Promise<{
  path: string;
  high: number;
  medium: number;
  serper_calls: number;
}> {
  const runDir = resolve(options.runDir);
  mkdirSync(runDir, { recursive: true });
  const inputPath = join(runDir, 'platform_only.csv');
  if (!existsSync(inputPath)) {
    throw new Error(`Missing ${inputPath}. Run prep-from-prospects first.`);
  }

  let rows = readCsv(inputPath);
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  const outPath = join(runDir, 'domains_discovered.csv');
  const checkpointPath = join(runDir, 'serper_checkpoint.json');

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      vendor: 'Serper',
      platform_only_rows: readCsv(inputPath).length,
      this_wave_queries: rows.length,
      dollars: serperEstimate(rows.length, null).dollars,
      sample_40_dollars: 0.04,
      full_ceiling_dollars: serperEstimate(readCsv(inputPath).length, null).dollars,
      note: 'Live requires --live after explicit spend OK. First wave should be --max-rows 40.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'serper_dry_run.json'), estimate);
    return { path: outPath, high: 0, medium: 0, serper_calls: 0 };
  }

  if (!options.live) {
    throw new Error('Live Serper spend requires --live after explicit spend OK.');
  }

  await ensureEnv({ apollo: false, prospeo: false, serper: true });
  if (!process.env.SERPER_API_KEY?.trim()) {
    throw new Error('SERPER_API_KEY not available');
  }

  type Checkpoint = {
    next_index: number;
    results: DiscoverResultRow[];
    serper_calls: number;
  };
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    next_index: 0,
    results: [],
    serper_calls: 0,
  };

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    const row = rows[i]!;
    const name = (row.company_name ?? '').trim();
    const query = `"${name}" official website`;
    console.error(`[serper] ${i + 1}/${rows.length} ${name}`);

    let best: ScoredDomain | null = null;
    let error = '';
    try {
      const json = await serperSearch(query);
      checkpoint.serper_calls += 1;
      best = usableScored(name, json);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    checkpoint.results.push({
      company_name: name,
      discovered_domain: best?.domain ?? '',
      score: best ? String(best.score) : '0',
      tier: best?.tier ?? 'low',
      reasons: best?.reasons.join('|') ?? '',
      query,
      status: best && best.tier !== 'low' ? 'candidate' : 'no_match',
      error,
    });
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, DISCOVER_COLUMNS);
    await new Promise((r) => setTimeout(r, 150));
  }

  const highRows = checkpoint.results.filter((r) => r.tier === 'high' && r.discovered_domain);
  const medium = checkpoint.results.filter((r) => r.tier === 'medium' && r.discovered_domain);
  writeCsv(join(runDir, 'domains_review.csv'), medium, DISCOVER_COLUMNS);

  mergeHighDomains(runDir, highRows);

  writeJson(join(runDir, 'serper_tally.json'), {
    serper_calls: checkpoint.serper_calls,
    high: highRows.length,
    medium: medium.length,
    low: checkpoint.results.filter((r) => r.tier === 'low' || !r.discovered_domain).length,
  });

  return {
    path: outPath,
    high: highRows.length,
    medium: medium.length,
    serper_calls: checkpoint.serper_calls,
  };
}

export function mergeHighDomains(
  runDir: string,
  highRows: Array<{ company_name: string; discovered_domain: string }>,
): void {
  const companiesPath = join(runDir, 'companies.csv');
  const existing = existsSync(companiesPath) ? (readCsv(companiesPath) as CompanyRow[]) : [];
  const byDomain = new Map(existing.map((c) => [c.company_domain, c]));
  for (const row of highRows) {
    const domain = normalizeDomain(row.discovered_domain);
    if (!domain || byDomain.has(domain)) continue;
    byDomain.set(domain, {
      company_name: row.company_name,
      company_domain: domain,
      source_lists: 'ce-vendor-serper',
    });
  }
  writeCsv(companiesPath, [...byDomain.values()].map((c) => ({ ...c })), [...COMPANY_COLUMNS]);
}
