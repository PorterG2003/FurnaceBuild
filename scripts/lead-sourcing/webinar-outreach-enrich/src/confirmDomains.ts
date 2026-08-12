import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import {
  enrichOrganization,
  mapOrganization,
  type ApolloClientOptions,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { ensureEnv } from './env.js';
import { orgNameMatchesAdvertiser } from './domainScore.js';

const COLUMNS = [
  'ad_id',
  'company_name',
  'platform',
  'person_name',
  'discovered_domain',
  'tier',
  'score',
  'apollo_org_id',
  'apollo_org_name',
  'apollo_domain',
  'status',
  'error',
  'ad_library_url',
];

function loadAcceptedReview(pass3Dir: string): Set<string> {
  const path = join(pass3Dir, 'domains_review_accepted.json');
  if (!existsSync(path)) return new Set();
  const raw = loadJson<{ accepted_ad_ids?: string[] }>(path);
  return new Set(raw?.accepted_ad_ids ?? []);
}

export async function confirmDomains(options: {
  pass3Dir: string;
  dryRun?: boolean;
  liveConfirmed?: boolean;
  maxRows?: number | null;
  maxApolloOrgCalls?: number | null;
  /** Include medium tier only if accepted in review file. */
  includeAcceptedMedium?: boolean;
  /**
   * When set, only confirm these ad_ids (still must pass tier/accept rules).
   * Uses a separate checkpoint file so it does not desync the main high-tier resume cursor.
   */
  onlyAdIds?: Set<string>;
  checkpointName?: string;
  outputName?: string;
}): Promise<{ path: string; confirmed: number }> {
  const pass3Dir = ensureDir(options.pass3Dir);
  const outPath = join(pass3Dir, options.outputName ?? 'domains_confirmed.csv');
  const checkpointPath = join(
    pass3Dir,
    options.checkpointName ?? 'confirm_checkpoint.json',
  );

  const redirectPath = join(pass3Dir, 'domains_from_redirect.csv');
  const serperPath = join(pass3Dir, 'domains_discovered.csv');
  const accepted = loadAcceptedReview(pass3Dir);
  const only = options.onlyAdIds;

  const candidates: Record<string, string>[] = [];
  const seen = new Set<string>();

  const pushCand = (row: Record<string, string>, allowMedium: boolean) => {
    if (only && !only.has(row.ad_id)) return;
    const tier = row.tier;
    if (tier === 'high') {
      // ok
    } else if (tier === 'medium' && allowMedium && accepted.has(row.ad_id)) {
      // ok
    } else {
      return;
    }
    if (!row.discovered_domain) return;
    if (seen.has(row.ad_id || row.company_name)) return;
    seen.add(row.ad_id || row.company_name);
    candidates.push(row);
  };

  if (existsSync(redirectPath)) {
    for (const row of readCsv(redirectPath)) {
      pushCand(row, Boolean(options.includeAcceptedMedium));
    }
  }
  if (existsSync(serperPath)) {
    for (const row of readCsv(serperPath)) {
      pushCand(row, Boolean(options.includeAcceptedMedium));
    }
  }

  let rows = candidates;
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      candidates: rows.length,
      estimated_apollo_org_calls: rows.length,
      max_apollo_org_calls: options.maxApolloOrgCalls,
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(pass3Dir, 'confirm_dry_run.json'), estimate);
    return { path: outPath, confirmed: 0 };
  }

  if (!options.liveConfirmed) {
    throw new Error('Live Apollo confirm requires --live after explicit spend OK.');
  }

  await ensureEnv({ apollo: true, prospeo: false });
  if (!process.env.APOLLO_API_KEY?.trim()) {
    throw new Error('APOLLO_API_KEY not available');
  }

  type Checkpoint = { next_index: number; results: Record<string, string>[]; org_calls: number };
  let checkpoint = loadJson<Checkpoint>(checkpointPath) ?? {
    next_index: 0,
    results: [],
    org_calls: 0,
  };

  const counter = new CallCounter();
  const apolloOptions: ApolloClientOptions = { useFixtures: false, counter };

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    if (
      options.maxApolloOrgCalls != null &&
      checkpoint.org_calls >= options.maxApolloOrgCalls
    ) {
      console.error(`[confirm] hit max apollo org calls at ${i}/${rows.length}`);
      break;
    }

    const row = rows[i]!;
    console.error(`[confirm] ${i + 1}/${rows.length} ${row.company_name} → ${row.discovered_domain}`);

    let status = 'rejected';
    let error = '';
    let apolloOrgId = '';
    let apolloOrgName = '';
    let apolloDomain = '';

    try {
      const org = await enrichOrganization(
        { domain: row.discovered_domain, name: row.company_name },
        apolloOptions,
      );
      checkpoint.org_calls += 1;
      const mapped = mapOrganization(org);
      apolloOrgId = mapped.apollo_org_id;
      apolloOrgName = mapped.company_name || org?.name || '';
      apolloDomain = mapped.company_domain || row.discovered_domain;

      if (!apolloOrgId) {
        status = 'apollo_not_found';
      } else {
        const advertiser = row.company_name || '';
        const queryName = (row.best_company_query || '').trim();
        const nameOk =
          orgNameMatchesAdvertiser(advertiser, apolloOrgName || advertiser) ||
          (queryName.length > 0 &&
            orgNameMatchesAdvertiser(queryName, apolloOrgName || queryName));
        if (!nameOk) {
          status = 'domain_rejected_name_mismatch';
          error = `org="${apolloOrgName}" vs advertiser="${advertiser}"${queryName ? ` query="${queryName}"` : ''}`;
        } else {
          status = 'confirmed';
        }
      }
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
      checkpoint.org_calls += 1;
    }

    checkpoint.results.push({
      ad_id: row.ad_id ?? '',
      company_name: row.company_name ?? '',
      platform: row.platform ?? '',
      person_name: row.person_name ?? '',
      discovered_domain: row.discovered_domain ?? '',
      tier: row.tier ?? '',
      score: row.score ?? '',
      apollo_org_id: apolloOrgId,
      apollo_org_name: apolloOrgName,
      apollo_domain: apolloDomain,
      status,
      error,
      ad_library_url: row.ad_library_url ?? '',
    });
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, COLUMNS);
    await new Promise((r) => setTimeout(r, 200));
  }

  const confirmed = checkpoint.results.filter((r) => r.status === 'confirmed').length;
  writeJson(join(pass3Dir, 'confirm_tally.json'), {
    org_calls: checkpoint.org_calls,
    confirmed,
    rejected: checkpoint.results.length - confirmed,
  });
  console.log(
    JSON.stringify({ done: true, org_calls: checkpoint.org_calls, confirmed }, null, 2),
  );
  return { path: outPath, confirmed };
}
