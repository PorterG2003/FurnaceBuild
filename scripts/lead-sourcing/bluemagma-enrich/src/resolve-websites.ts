import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir, truncateRows, requireLiveForPaid } from './lib/cli.js';
import { loadEnv, ensureEnv, packageRoot } from './lib/env.js';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { ensureDir, loadJson, writeJson } from './lib/io.js';
import { sleep } from './lib/retry.js';
import { enrichOrganization, fundingFieldsFromOrg, emptyFundingFields } from './lib/apolloClient.js';
import { serperSearch, type SerperResponse } from './lib/serperClient.js';
import {
  pickBestScored,
  scoreDomainCandidate,
  orgNameMatchesAdvertiser,
  type DomainCandidate,
  type ScoredDomain,
} from './lib/domainScore.js';
import {
  DOMAIN_COLUMNS,
  normalizeDomain,
  normalizeLinkedInCompanyUrl,
  type DomainSource,
} from './lib/types.js';

function candidatesFromSerper(json: SerperResponse): DomainCandidate[] {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Checkpoint = {
  next_index: number;
  results: Record<string, string>[];
  apollo_org_calls: number;
  serper_calls: number;
};

export async function resolveWebsites(options: {
  runDir: string;
  dryRun?: boolean;
  live?: boolean;
  fixtures?: boolean;
  maxRows?: number | null;
  acceptMedium?: boolean;
}): Promise<{ path: string; withDomain: number }> {
  const runDir = ensureDir(options.runDir);
  const inputPath = join(runDir, 'companies.csv');
  if (!existsSync(inputPath)) throw new Error(`Missing ${inputPath}. Run prep first.`);

  let rows = readCsv(inputPath);
  rows = truncateRows(rows, options.maxRows ?? null);
  const outPath = join(runDir, 'companies_with_domains.csv');
  const checkpointPath = join(runDir, 'websites_checkpoint.json');

  const withLinkedIn = rows.filter((r) => r.company_linkedin).length;
  const serperFallback = rows.length - withLinkedIn;

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      companies: rows.length,
      estimated_apollo_org_calls: rows.length,
      estimated_serper_website_searches: serperFallback,
      note: 'Apollo LinkedIn-first; Serper only when LinkedIn enrich misses or there is no company LinkedIn. Confirm adds up to 1 more Apollo call per Serper domain.',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'websites_dry_run.json'), estimate);
    return { path: outPath, withDomain: 0 };
  }

  requireLiveForPaid({
    live: Boolean(options.live),
    dryRun: false,
    fixtures: Boolean(options.fixtures),
    vendor: 'Apollo/Serper',
  });

  if (!options.fixtures) {
    await ensureEnv({ apollo: true, serper: true });
    if (!process.env.APOLLO_API_KEY?.trim()) throw new Error('APOLLO_API_KEY not available');
  }

  const accepted = new Set(
    loadJson<{ accepted_company_keys?: string[] }>(join(runDir, 'domains_review_accepted.json'))
      ?.accepted_company_keys ?? [],
  );

  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    next_index: 0,
    results: [],
    apollo_org_calls: 0,
    serper_calls: 0,
  };

  const apolloOpts = {
    useFixtures: Boolean(options.fixtures),
    onCall: () => {
      checkpoint.apollo_org_calls += 1;
    },
  };

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    const row = rows[i]!;
    const name = (row.company_name ?? '').trim();
    const linkedin = normalizeLinkedInCompanyUrl(row.company_linkedin ?? '');
    console.error(`[websites ${i + 1}/${rows.length}] ${name || row.company_key}`);

    let domain = '';
    let source: DomainSource = '';
    let tier = '';
    let score = '';
    let apolloId = '';
    let apolloName = '';
    let status = 'not_found';
    let error = '';
    let funding = emptyFundingFields();

    try {
      if (linkedin) {
        const org = await enrichOrganization({ linkedinUrl: linkedin, name: name || undefined }, apolloOpts);
        const found = normalizeDomain(org?.primary_domain ?? org?.website_url ?? '');
        if (found) {
          domain = found;
          source = 'apollo_linkedin';
          tier = 'high';
          score = '1';
          apolloId = org?.id ?? '';
          apolloName = org?.name ?? '';
          status = 'confirmed';
          funding = fundingFieldsFromOrg(org);
        }
      }

      if (!domain && name) {
        if (!options.fixtures && !process.env.SERPER_API_KEY?.trim()) {
          await ensureEnv({ serper: true });
        }
        const query = `"${name}" official website`;
        const json = await serperSearch(query, {
          useFixtures: Boolean(options.fixtures),
          onCall: () => {
            checkpoint.serper_calls += 1;
          },
        });
        const scored = candidatesFromSerper(json).map((c) => scoreDomainCandidate(name, c));
        const best: ScoredDomain | null = pickBestScored(scored);
        if (best) {
          const allowMedium =
            Boolean(options.fixtures) || Boolean(options.acceptMedium) || accepted.has(row.company_key);
          if (best.tier === 'high' || (best.tier === 'medium' && allowMedium)) {
            domain = best.domain;
            source = 'serper';
            tier = best.tier;
            score = String(best.score);
            status = 'candidate';

            const org = await enrichOrganization({ domain: best.domain, name }, apolloOpts);
            if (org?.name && orgNameMatchesAdvertiser(name, org.name)) {
              domain = normalizeDomain(org.primary_domain ?? org.website_url ?? '') || domain;
              source = 'apollo_confirm';
              apolloId = org.id ?? '';
              apolloName = org.name ?? '';
              status = 'confirmed';
              tier = 'high';
              funding = fundingFieldsFromOrg(org);
            } else if (org?.name) {
              status = 'domain_rejected_name_mismatch';
              domain = '';
              source = '';
            } else if (best.tier === 'high') {
              status = 'apollo_not_found';
            }
          } else {
            domain = best.domain;
            source = 'serper';
            tier = best.tier;
            score = String(best.score);
            status = 'needs_review';
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      status = 'error';
    }

    checkpoint.results.push(
      rowToRecord({
        ...row,
        company_domain: domain,
        domain_source: source,
        domain_tier: tier,
        domain_score: score,
        apollo_org_id: apolloId,
        apollo_org_name: apolloName,
        website_status: status,
        website_error: error,
        ...funding,
      }),
    );
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, DOMAIN_COLUMNS);
    if (!options.fixtures) await sleep(150);
  }

  const medium = checkpoint.results.filter((r) => r.domain_tier === 'medium' || r.website_status === 'needs_review');
  const cards = medium
    .map(
      (r) => `
    <article style="border:1px solid #ddd;padding:12px;margin:8px 0;border-radius:8px">
      <h3>${escapeHtml(r.company_name)} <small>(${escapeHtml(r.domain_tier)} ${escapeHtml(r.domain_score)})</small></h3>
      <p>key=${escapeHtml(r.company_key)}</p>
      <p>domain: <a href="https://${escapeHtml(r.company_domain)}" target="_blank">${escapeHtml(r.company_domain)}</a></p>
      <p>status=${escapeHtml(r.website_status)}</p>
    </article>`,
    )
    .join('\n');
  writeFileSync(
    join(runDir, 'domains_review.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>Domain review</title></head>
<body style="font-family:system-ui;max-width:900px;margin:24px auto">
<h1>Medium-confidence domains</h1>
<p>Accept by writing company_keys into domains_review_accepted.json as {"accepted_company_keys":["..."]}</p>
${cards}
</body></html>`,
    'utf8',
  );

  const withDomain = checkpoint.results.filter((r) => r.company_domain && r.website_status !== 'needs_review').length;
  writeJson(join(runDir, 'websites_tally.json'), {
    apollo_org_calls: checkpoint.apollo_org_calls,
    serper_calls: checkpoint.serper_calls,
    companies: checkpoint.results.length,
    with_domain: withDomain,
    needs_review: medium.filter((r) => r.website_status === 'needs_review').length,
  });
  console.log(
    JSON.stringify(
      {
        done: true,
        apollo_org_calls: checkpoint.apollo_org_calls,
        serper_calls: checkpoint.serper_calls,
        with_domain: withDomain,
      },
      null,
      2,
    ),
  );
  return { path: outPath, withDomain };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  await resolveWebsites({
    runDir,
    dryRun: cli.dryRun,
    live: cli.live,
    fixtures: cli.fixtures,
    maxRows: cli.maxRows,
    acceptMedium: cli.acceptMedium,
  });
}

if (process.argv[1]?.includes('resolve-websites.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
