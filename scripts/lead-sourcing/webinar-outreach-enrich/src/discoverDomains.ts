import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { ensureEnv } from './env.js';
import { serperSearch } from './serperClient.js';
import {
  pickBestScored,
  scoreDomainCandidate,
  type DomainCandidate,
  type ScoredDomain,
} from './domainScore.js';

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

function writeReviewHtml(path: string, rows: Record<string, string>[]): void {
  const cards = rows
    .map(
      (r) => `
    <article style="border:1px solid #ddd;padding:12px;margin:8px 0;border-radius:8px">
      <h3>${escapeHtml(r.company_name)} <small>(${escapeHtml(r.tier)} ${escapeHtml(r.score)})</small></h3>
      <p>platform=${escapeHtml(r.platform)} ad_id=${escapeHtml(r.ad_id)}</p>
      <p>domain: <a href="https://${escapeHtml(r.discovered_domain)}" target="_blank">${escapeHtml(r.discovered_domain)}</a></p>
      <p>query: ${escapeHtml(r.query)}</p>
      <p>reasons: ${escapeHtml(r.reasons)}</p>
    </article>`,
    )
    .join('\n');
  writeFileSync(
    path,
    `<!doctype html><html><head><meta charset="utf-8"><title>Pass3 domain review</title></head>
<body style="font-family:system-ui;max-width:900px;margin:24px auto">
<h1>Pass 3 domain review (medium confidence)</h1>
<p>Accept by writing ad_ids into domains_review_accepted.json</p>
${cards}
</body></html>`,
    'utf8',
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function discoverDomains(options: {
  inputCsv: string;
  outDir: string;
  dryRun?: boolean;
  maxRows?: number | null;
  liveConfirmed?: boolean;
  /** Skip companies already recovered via redirect expansion (high/medium). */
  skipAdIds?: Set<string>;
}): Promise<{ path: string; high: number; medium: number }> {
  const outDir = ensureDir(options.outDir);
  const outPath = join(outDir, 'domains_discovered.csv');
  const checkpointPath = join(outDir, 'serper_checkpoint.json');

  let rows = readCsv(options.inputCsv);
  if (options.skipAdIds?.size) {
    rows = rows.filter((r) => !options.skipAdIds!.has(r.ad_id));
  }
  // Prefer rows without expandable success; still allow all residual
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun) {
    const residual = rows.length;
    const estimate = {
      dry_run: true,
      serper_calls: residual,
      skipped_already_recovered: options.skipAdIds?.size ?? 0,
      max_rows: options.maxRows,
      note: 'After expand, re-run dry-run to see residual Serper count with skips applied.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(outDir, 'serper_dry_run.json'), estimate);
    return { path: outPath, high: 0, medium: 0 };
  }

  if (!options.liveConfirmed) {
    throw new Error('Live Serper spend requires --live after explicit spend OK.');
  }

  await ensureEnv({ apollo: false, prospeo: false, serper: true });
  if (!process.env.SERPER_API_KEY?.trim()) {
    throw new Error('SERPER_API_KEY not available');
  }

  type Checkpoint = {
    next_index: number;
    results: Record<string, string>[];
    serper_calls: number;
  };
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    next_index: 0,
    results: [],
    serper_calls: 0,
  };

  const columns = [
    'ad_id',
    'company_name',
    'platform',
    'person_name',
    'discovered_domain',
    'score',
    'tier',
    'reasons',
    'query',
    'status',
    'error',
    'ad_library_url',
    'best_company_query',
  ];

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    const row = rows[i]!;
    const queryName = (row.best_company_query || row.serper_query || row.company_name || '').trim();
    const query = `"${queryName}" official website`;
    console.error(`[serper] ${i + 1}/${rows.length} ${queryName}`);

    let best: ScoredDomain | null = null;
    let error = '';
    try {
      const json = await serperSearch(query);
      checkpoint.serper_calls += 1;
      const scored = candidatesFromSerper(json).map((c) =>
        scoreDomainCandidate(queryName || row.company_name, c),
      );
      best = pickBestScored(scored);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    checkpoint.results.push({
      ad_id: row.ad_id ?? '',
      company_name: row.company_name ?? '',
      platform: row.platform ?? '',
      person_name: row.person_name ?? '',
      discovered_domain: best?.domain ?? '',
      score: best ? String(best.score) : '0',
      tier: best?.tier ?? 'low',
      reasons: best?.reasons.join('|') ?? '',
      query,
      status: best && best.tier !== 'low' ? 'candidate' : 'no_match',
      error,
      ad_library_url: row.ad_library_url ?? '',
      best_company_query: queryName,
    });
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, columns);
    await new Promise((r) => setTimeout(r, 150));
  }

  const medium = checkpoint.results.filter((r) => r.tier === 'medium');
  writeReviewHtml(join(outDir, 'domains_review.html'), medium);

  const high = checkpoint.results.filter((r) => r.tier === 'high').length;
  writeJson(join(outDir, 'serper_tally.json'), {
    serper_calls: checkpoint.serper_calls,
    high,
    medium: medium.length,
    low: checkpoint.results.filter((r) => r.tier === 'low' || !r.discovered_domain).length,
  });
  console.log(
    JSON.stringify(
      { done: true, serper_calls: checkpoint.serper_calls, high, medium: medium.length },
      null,
      2,
    ),
  );
  return { path: outPath, high, medium: medium.length };
}
