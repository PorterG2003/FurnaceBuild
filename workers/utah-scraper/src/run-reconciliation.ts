/**
 * ECS entry: load Utah company IDs from foundry_jobs payload, scrape Utah portal, persist to leads DB, reconcile.
 * Env: JOB_ID, RECONCILIATION_RUN_ID, LEADS_SUPABASE_URL,
 *      LEADS_SUPABASE_SECRET_KEY or LEADS_SUPABASE_SECRET_KEY_PARAM_PATH (same pattern as send-worker + SUPABASE_SECRET_KEY).
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import {
  persistUtahRegistryPull,
  reconcileCompanyToStateEntity,
} from '@furnace/registry-server';
import { scrapeUtahRow, type CsvRow } from './browser.js';

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
    console.error(`Utah reconciliation: missing environment variable(s): ${missingEnv.join(', ')}`);
    process.exit(1);
  }

  const leadsUrl = url as string;
  const reconciliationId = reconciliationRunId as string;
  const jobIdResolved = jobId as string;

  if (paramPath && !secretKey) {
    console.log(`Fetching LEADS_SUPABASE_SECRET_KEY from Parameter Store: ${paramPath}`);
    secretKey = await fetchSecretFromParameterStore(paramPath, awsRegion);
    process.env.LEADS_SUPABASE_SECRET_KEY = secretKey;
  }

  if (!secretKey) {
    console.error('Utah reconciliation: LEADS_SUPABASE_SECRET_KEY is empty after SSM fetch');
    process.exit(1);
  }

  const leadsSecretKey = secretKey;

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

  const payload = (jobRow.payload ?? {}) as { utah_company_ids?: string[] };
  const companyIds = payload.utah_company_ids ?? [];
  const rateMs = Number(process.env.RATE_MS ?? '2000');
  const perCompany: Record<string, unknown>[] = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);

  for (let i = 0; i < companyIds.length; i++) {
    if (i > 0 && rateMs > 0) {
      await new Promise((r) => setTimeout(r, rateMs + Math.floor(Math.random() * 500)));
    }
    const companyId = companyIds[i];
    const { data: co, error: coErr } = await client
      .from('companies')
      .select('id, legal_name, normalized_key')
      .eq('id', companyId)
      .maybeSingle();
    if (coErr || !co) {
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

    const r = await scrapeUtahRow(page, row, { isFirst: i === 0 });
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
        perCompany.push({ companyId, state: 'UT', error: r.error ?? r.compareReason });
        continue;
      }

      const { state_entity_id } = await persistUtahRegistryPull(client, {
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
      perCompany.push({ companyId, state: 'UT', state_entity_id, ...recon });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
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

  await browser.close();

  const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', jobIdResolved).maybeSingle();
  const prev = (job?.progress ?? {}) as Record<string, unknown>;
  await client
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress: {
        ...prev,
        current_step: 'utah_ecs_done',
        utah_per_company: perCompany,
      },
    })
    .eq('id', jobIdResolved);

  console.log(
    JSON.stringify({ jobId: jobIdResolved, utahCompanies: companyIds.length, perCompany: perCompany.length }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
