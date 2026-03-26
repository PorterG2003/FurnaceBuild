/**
 * ECS entry: load Florida company IDs from foundry_jobs payload, scrape Sunbiz, persist to leads DB, reconcile.
 * Env: JOB_ID, RECONCILIATION_RUN_ID, LEADS_SUPABASE_URL,
 *      LEADS_SUPABASE_SECRET_KEY or LEADS_SUPABASE_SECRET_KEY_PARAM_PATH.
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import {
  persistFloridaRegistryPull,
  reconcileCompanyToStateEntity,
} from '@furnace/registry-server';
import { createSunbizSession, scrapeFloridaRow, type CsvRow } from './browser.js';

function logRec(event: string, data?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ source: 'florida-reconciliation', event, at: new Date().toISOString(), ...data }),
  );
}

function lookupKey(normalizedKey: string | null, legalName: string): string {
  const nk = normalizedKey?.trim();
  if (nk) return nk;
  return legalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchSecretFromParameterStore(parameterPath: string, region: string): Promise<string> {
  const ssmClient = new SSMClient({ region });
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterPath,
        WithDecryption: true,
      }),
    );
    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterPath} has no value`);
    }
    return response.Parameter.Value.trim();
  } catch (error) {
    throw new Error(`Failed to fetch secret from Parameter Store: ${error}`);
  }
}

async function main() {
  const jobId = process.env.JOB_ID?.trim();
  const reconciliationRunId = process.env.RECONCILIATION_RUN_ID?.trim();
  const url = process.env.LEADS_SUPABASE_URL?.trim();
  const paramPath = process.env.LEADS_SUPABASE_SECRET_KEY_PARAM_PATH?.trim();
  let secretKey = process.env.LEADS_SUPABASE_SECRET_KEY?.trim();
  const awsRegion = process.env.AWS_REGION || 'us-west-2';

  const missingEnv: string[] = [];
  if (!jobId) missingEnv.push('JOB_ID');
  if (!reconciliationRunId) missingEnv.push('RECONCILIATION_RUN_ID');
  if (!url) missingEnv.push('LEADS_SUPABASE_URL');
  if (!secretKey && !paramPath) {
    missingEnv.push('LEADS_SUPABASE_SECRET_KEY or LEADS_SUPABASE_SECRET_KEY_PARAM_PATH');
  }
  if (missingEnv.length > 0) {
    console.error(`Florida reconciliation: missing environment variable(s): ${missingEnv.join(', ')}`);
    process.exit(1);
  }

  const leadsUrl = url as string;
  const reconciliationId = reconciliationRunId as string;
  const jobIdResolved = jobId as string;

  logRec('worker-start', {
    jobId: jobIdResolved,
    reconciliationRunId: reconciliationId,
    awsRegion,
    rateMs: Number(process.env.RATE_MS ?? '2000'),
  });

  if (paramPath && !secretKey) {
    logRec('ssm-fetch-start', { parameterPath: paramPath });
    secretKey = await fetchSecretFromParameterStore(paramPath, awsRegion);
    process.env.LEADS_SUPABASE_SECRET_KEY = secretKey;
    logRec('ssm-fetch-done', {});
  }

  if (!secretKey) {
    console.error('Florida reconciliation: LEADS_SUPABASE_SECRET_KEY is empty after SSM fetch');
    process.exit(1);
  }

  const leadsSecretKey = secretKey;

  logRec('supabase-client-init', {});

  const client = createClient(leadsUrl, leadsSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: jobRow, error: jobErr } = await client
    .from('foundry_jobs')
    .select('payload')
    .eq('id', jobIdResolved)
    .maybeSingle();
  if (jobErr || !jobRow) {
    console.error('foundry_jobs load failed', jobErr?.message);
    process.exit(1);
  }

  const payload = (jobRow.payload ?? {}) as { florida_company_ids?: string[] };
  const companyIds = payload.florida_company_ids ?? [];
  const rateMs = Number(process.env.RATE_MS ?? '2000');
  const perCompany: Record<string, unknown>[] = [];

  logRec('job-payload-loaded', { floridaCompanyCount: companyIds.length });

  logRec('sunbiz-session-start', {});
  const { browser, page } = await createSunbizSession();
  logRec('sunbiz-session-ready', {});

  try {
    for (let i = 0; i < companyIds.length; i++) {
      if (i > 0 && rateMs > 0) {
        await new Promise((r) => setTimeout(r, rateMs + Math.floor(Math.random() * 500)));
      }
      const companyId = companyIds[i];
      logRec('company-start', {
        index: i + 1,
        total: companyIds.length,
        companyId,
      });
      const { data: co, error: coErr } = await client
        .from('companies')
        .select('id, legal_name, normalized_key')
        .eq('id', companyId)
        .maybeSingle();
      if (coErr || !co) {
        logRec('company-skip', { companyId, reason: coErr?.message ?? 'company not found' });
        perCompany.push({ companyId, error: coErr?.message ?? 'company not found' });
        await client.from('reconciliation_results').insert({
          reconciliation_run_id: reconciliationId,
          company_id: companyId,
          outcome: 'error',
          details: { message: 'company not found' },
          matcher_version: 'foundry_matcher_v1',
          scoring_version: 'foundry_score_v1',
          ruleset_version: 'foundry_rules_v1',
        });
        continue;
      }

      const row: CsvRow = {
        Id: co.id as string,
        'Company Name': (co.legal_name as string) ?? '',
        'Enrich company': '',
        'Name - People - Results': '',
      };

      const r = await scrapeFloridaRow(page, row, { isFirst: i === 0 });
      logRec('company-scrape-finished', {
        companyId,
        compareOutcome: r.compareOutcome,
        compareReason: r.compareReason,
        error: r.error,
      });
      const lk = lookupKey(co.normalized_key as string | null, (co.legal_name as string) ?? '');

      try {
        if (!r.parsedDetail || r.error === 'parse_detail_failed' || r.error === 'ambiguous_search') {
          await client.from('reconciliation_results').insert({
            reconciliation_run_id: reconciliationId,
            company_id: companyId,
            outcome: 'error',
            details: {
              scrape: r.compareReason,
              error: r.error,
            },
            matcher_version: 'foundry_matcher_v1',
            scoring_version: 'foundry_score_v1',
            ruleset_version: 'foundry_rules_v1',
          });
          perCompany.push({ companyId, state: 'FL', error: r.error ?? r.compareReason });
          logRec('company-persist-skipped', { companyId, error: r.error ?? r.compareReason });
          continue;
        }

        logRec('company-persist-start', { companyId });
        const { state_entity_id } = await persistFloridaRegistryPull(client, {
          companyId,
          lookupKey: lk,
          detail: r.parsedDetail,
          detailHtml: r.detailHtml ?? '',
          searchQuery: r.searchQuery,
          hitStatus: r.hitStatus,
        });

        const recon = await reconcileCompanyToStateEntity(client, {
          reconciliationRunId: reconciliationId,
          companyId,
          stateEntityId: state_entity_id,
        });
        perCompany.push({ companyId, state: 'FL', state_entity_id, ...recon });
        logRec('company-done', { companyId, state_entity_id });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logRec('company-error', { companyId, message });
        perCompany.push({ companyId, error: message });
        await client.from('reconciliation_results').insert({
          reconciliation_run_id: reconciliationId,
          company_id: companyId,
          outcome: 'error',
          details: { message },
          matcher_version: 'foundry_matcher_v1',
          scoring_version: 'foundry_score_v1',
          ruleset_version: 'foundry_rules_v1',
        });
      }
    }
    logRec('company-loop-finished', { processed: companyIds.length });
  } finally {
    logRec('browser-closing', {});
    await browser.close().catch(() => {});
    logRec('browser-closed', {});
  }

  logRec('job-progress-update-start', { jobId: jobIdResolved });
  const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', jobIdResolved).maybeSingle();
  const prev = (job?.progress ?? {}) as Record<string, unknown>;
  await client
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress: {
        ...prev,
        current_step: 'florida_ecs_done',
        florida_per_company: perCompany,
      },
    })
    .eq('id', jobIdResolved);

  logRec('job-progress-update-done', {});

  console.log(
    JSON.stringify({ jobId: jobIdResolved, floridaCompanies: companyIds.length, perCompany: perCompany.length }),
  );
  logRec('worker-finished', {
    jobId: jobIdResolved,
    floridaCompanies: companyIds.length,
    perCompany: perCompany.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
