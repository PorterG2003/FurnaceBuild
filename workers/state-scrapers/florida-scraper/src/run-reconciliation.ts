/**
 * ECS entry: load Florida company IDs from foundry_jobs payload, scrape Sunbiz, persist to leads DB, reconcile.
 * Env: JOB_ID, RECONCILIATION_RUN_ID, LEADS_SUPABASE_URL,
 *      LEADS_SUPABASE_SECRET_KEY or LEADS_SUPABASE_SECRET_KEY_PARAM_PATH.
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import {
  buildDrilldownWorkItem,
  buildOwnerQueryKey,
  buildRegistryEntityKey,
  classifyOwnerName,
  flushStateMatchingJobOutcomeProgress,
  ownerResolutionStatusForSeed,
  patchFoundryJobProgress,
  persistFloridaRegistryPull,
  reconcileCompanyToStateEntity,
  resolveRunCost,
  stateMatchingProgressFlushStride,
  updateEntityOwnerResolution,
  type DrilldownWorkItem,
  type OwnerResolutionStatus,
  type PersistEntityOwnerInput,
  type PersistedEntityOwnerRow,
} from '@furnace/registry-server';
import { createSunbizSession, scrapeFloridaEntityByName, type CsvRow } from './browser.js';

const DRILLDOWN_DEPTH_MAX = 4;

type DrilldownStats = {
  drilldown_scraped_count: number;
  drilldown_resolved_count: number;
  drilldown_ambiguous_count: number;
  drilldown_no_hit_count: number;
  drilldown_parse_failed_count: number;
  drilldown_cycle_skipped_count: number;
  drilldown_max_depth_count: number;
};

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

function emptyDrilldownStats(): DrilldownStats {
  return {
    drilldown_scraped_count: 0,
    drilldown_resolved_count: 0,
    drilldown_ambiguous_count: 0,
    drilldown_no_hit_count: 0,
    drilldown_parse_failed_count: 0,
    drilldown_cycle_skipped_count: 0,
    drilldown_max_depth_count: 0,
  };
}

function classifyOwnersForPersistence(
  owners: PersistEntityOwnerInput[],
  currentEntityDepth: number,
): PersistEntityOwnerInput[] {
  const discoveryDepth = currentEntityDepth + 1;
  return owners.map((owner) => {
    const classification = classifyOwnerName(owner.ownerName);
    return {
      ...owner,
      ownerKind: classification.kind,
      resolutionStatus: ownerResolutionStatusForSeed({
        kind: classification.kind,
        discoveryDepth,
        depthMax: DRILLDOWN_DEPTH_MAX,
      }),
      discoveryDepth,
      resolutionNotes: {
        classification_reason: classification.reason,
      },
    };
  });
}

function enqueueEntityOwners(params: {
  queue: DrilldownWorkItem[];
  owners: PersistedEntityOwnerRow[];
  state: string;
  originCompanyId: string;
  parentStateEntityId: string;
  stats: DrilldownStats;
}): void {
  for (const owner of params.owners) {
    if (owner.resolution_status === 'max_depth_reached') {
      params.stats.drilldown_max_depth_count += 1;
      continue;
    }
    if (owner.owner_kind !== 'entity' || owner.resolution_status !== 'entity_enqueued') continue;
    if (owner.discovery_depth == null) continue;
    params.queue.push(
      buildDrilldownWorkItem({
        state: params.state,
        originCompanyId: params.originCompanyId,
        depth: owner.discovery_depth,
        ownerNameRaw: owner.owner_name,
        parentStateEntityId: params.parentStateEntityId,
        ownerRowId: owner.id,
      }),
    );
  }
}

async function applyOwnerOutcome(
  client: ReturnType<typeof createClient>,
  ownerRowId: string,
  outcome: {
    status: OwnerResolutionStatus;
    resolvedStateEntityId?: string | null;
    notes?: Record<string, unknown>;
  },
): Promise<void> {
  await updateEntityOwnerResolution(
    client as unknown as Parameters<typeof updateEntityOwnerResolution>[0],
    {
      entityOwnerId: ownerRowId,
      resolutionStatus: outcome.status,
      resolvedStateEntityId: outcome.resolvedStateEntityId,
      resolutionNotes: outcome.notes,
    },
  );
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
  const runtimeCost = await resolveRunCost(
    client as any,
    'acquisition',
    'furnace_runtime',
    'florida_registry_pull_ms',
    undefined,
    { usageUnit: 'ms', unitQuantity: 3600000 },
  );

  const { data: jobRow, error: jobErr } = await client
    .from('foundry_jobs')
    .select('payload, progress')
    .eq('id', jobIdResolved)
    .maybeSingle();
  if (jobErr || !jobRow) {
    console.error('foundry_jobs load failed', jobErr?.message);
    process.exit(1);
  }

  const payload = (jobRow.payload ?? {}) as { florida_company_ids?: string[] };
  const initialProgress = (jobRow.progress ?? {}) as Record<string, unknown>;
  const companyIds = (() => {
    const envJson = process.env.COMPANY_IDS_JSON?.trim();
    if (envJson) {
      try {
        const parsed = JSON.parse(envJson);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
        }
      } catch (e) {
        console.error('Failed to parse COMPANY_IDS_JSON', e);
      }
    }
    return payload.florida_company_ids ?? [];
  })();
  const rateMs = Number(process.env.RATE_MS ?? '2000');
  const perCompany: Record<string, unknown>[] = [];
  const flushStride = stateMatchingProgressFlushStride(Number(initialProgress.in_scope_total ?? companyIds.length));
  let outcomesSinceFlush = 0;

  async function noteOutcomePersisted(): Promise<void> {
    outcomesSinceFlush += 1;
    if (outcomesSinceFlush < flushStride) return;
    logRec('job-progress-flush', { jobId: jobIdResolved, stride: flushStride });
    await flushStateMatchingJobOutcomeProgress(
      client as unknown as Parameters<typeof flushStateMatchingJobOutcomeProgress>[0],
      jobIdResolved,
      reconciliationId,
    );
    outcomesSinceFlush = 0;
  }

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
        await noteOutcomePersisted();
        continue;
      }

      const row: CsvRow = {
        Id: co.id as string,
        'Company Name': (co.legal_name as string) ?? '',
        'Enrich company': '',
        'Name - People - Results': '',
      };

      const rootStartedAt = Date.now();
      const r = await scrapeFloridaEntityByName(page, {
        query: (row['Company Name'] ?? '').trim(),
        isFirst: i === 0,
      });
      logRec('company-scrape-finished', {
        companyId,
        status: r.status,
        error: r.status === 'exception' ? r.errorMessage : null,
      });
      const lk = lookupKey(co.normalized_key as string | null, (co.legal_name as string) ?? '');

      try {
        if (r.status !== 'ok') {
          const scrape = r.status === 'ambiguous' ? 'ambiguous_search' : r.status === 'parse_failed' ? 'parse_detail_failed' : r.status;
          await client.from('reconciliation_results').insert({
            reconciliation_run_id: reconciliationId,
            company_id: companyId,
            outcome: 'error',
            details: {
              scrape,
              error: r.status === 'exception' ? r.errorMessage : scrape,
            },
            matcher_version: 'foundry_matcher_v1',
            scoring_version: 'foundry_score_v1',
            ruleset_version: 'foundry_rules_v1',
          });
          await noteOutcomePersisted();
          perCompany.push({ companyId, state: 'FL', error: r.status === 'exception' ? r.errorMessage : scrape });
          logRec('company-persist-skipped', { companyId, error: r.status === 'exception' ? r.errorMessage : scrape });
          continue;
        }

        logRec('company-persist-start', { companyId });
        const drilldownStats = emptyDrilldownStats();
        const rootOwners = classifyOwnersForPersistence(r.owners, 0);
        const { state_entity_id, owners: persistedRootOwners } = await persistFloridaRegistryPull(
          client as unknown as Parameters<typeof persistFloridaRegistryPull>[0],
          {
            companyId,
            lookupKey: lk,
            detail: r.parsedDetail,
            detailHtml: r.detailHtml ?? '',
            searchQuery: r.searchQuery,
            hitStatus: r.hitStatus,
            owners: rootOwners,
            elapsedMs: Math.max(0, Date.now() - rootStartedAt),
            resolvedCost: runtimeCost,
            foundryJobId: jobIdResolved,
            reconciliationRunId: reconciliationId,
          },
        );

        const queue: DrilldownWorkItem[] = [];
        const queryOutcomes = new Map<
          string,
          {
            status: OwnerResolutionStatus;
            resolvedStateEntityId?: string | null;
            notes?: Record<string, unknown>;
          }
        >();
        const expandedRegistryKeys = new Set<string>();
        const resolvedByRegistryKey = new Map<string, string>();
        const rootRegistryKey = buildRegistryEntityKey('FL', r.entityNumber);
        expandedRegistryKeys.add(rootRegistryKey);
        resolvedByRegistryKey.set(rootRegistryKey, state_entity_id);
        enqueueEntityOwners({
          queue,
          owners: persistedRootOwners,
          state: 'FL',
          originCompanyId: companyId,
          parentStateEntityId: state_entity_id,
          stats: drilldownStats,
        });

        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.depth > DRILLDOWN_DEPTH_MAX) {
            await applyOwnerOutcome(client, item.ownerRowId, {
              status: 'max_depth_reached',
              notes: { owner_name: item.ownerNameRaw },
            });
            drilldownStats.drilldown_max_depth_count += 1;
            continue;
          }

          const queryKey = buildOwnerQueryKey('FL', item.ownerNameRaw);
          const priorOutcome = queryOutcomes.get(queryKey);
          if (priorOutcome) {
            await applyOwnerOutcome(client, item.ownerRowId, priorOutcome);
            drilldownStats.drilldown_cycle_skipped_count += 1;
            continue;
          }

          logRec('drilldown-start', {
            companyId,
            ownerName: item.ownerNameRaw,
            depth: item.depth,
          });
          const childStartedAt = Date.now();
          const child = await scrapeFloridaEntityByName(page, {
            query: item.ownerNameRaw,
            isFirst: false,
          });

          if (child.status === 'ambiguous') {
            const outcome = {
              status: 'entity_ambiguous' as const,
              notes: { owner_name: item.ownerNameRaw },
            };
            queryOutcomes.set(queryKey, outcome);
            await applyOwnerOutcome(client, item.ownerRowId, outcome);
            drilldownStats.drilldown_ambiguous_count += 1;
            continue;
          }
          if (child.status === 'no_hit') {
            const outcome = {
              status: 'entity_no_hit' as const,
              notes: { owner_name: item.ownerNameRaw },
            };
            queryOutcomes.set(queryKey, outcome);
            await applyOwnerOutcome(client, item.ownerRowId, outcome);
            drilldownStats.drilldown_no_hit_count += 1;
            continue;
          }
          if (child.status !== 'ok') {
            const outcome = {
              status: 'entity_parse_failed' as const,
              notes: {
                owner_name: item.ownerNameRaw,
                error: child.status === 'exception' ? child.errorMessage : child.status,
              },
            };
            queryOutcomes.set(queryKey, outcome);
            await applyOwnerOutcome(client, item.ownerRowId, outcome);
            drilldownStats.drilldown_parse_failed_count += 1;
            continue;
          }

          const registryKey = buildRegistryEntityKey('FL', child.entityNumber);
          const existingResolvedId = resolvedByRegistryKey.get(registryKey);
          if (existingResolvedId) {
            const outcome = {
              status: 'entity_resolved' as const,
              resolvedStateEntityId: existingResolvedId,
              notes: {
                owner_name: item.ownerNameRaw,
                registry_key: registryKey,
                reused_existing_entity: true,
              },
            };
            queryOutcomes.set(queryKey, outcome);
            await applyOwnerOutcome(client, item.ownerRowId, outcome);
            drilldownStats.drilldown_cycle_skipped_count += 1;
            continue;
          }

          const childOwners = classifyOwnersForPersistence(child.owners, item.depth);
          const persistedChild = await persistFloridaRegistryPull(
            client as unknown as Parameters<typeof persistFloridaRegistryPull>[0],
            {
              companyId,
              lookupKey: buildOwnerQueryKey('FL', item.ownerNameRaw),
              detail: child.parsedDetail,
              detailHtml: child.detailHtml,
              searchQuery: child.searchQuery,
              hitStatus: child.hitStatus,
              owners: childOwners,
              elapsedMs: Math.max(0, Date.now() - childStartedAt),
              resolvedCost: runtimeCost,
              foundryJobId: jobIdResolved,
              reconciliationRunId: reconciliationId,
            },
          );
          resolvedByRegistryKey.set(registryKey, persistedChild.state_entity_id);
          const outcome = {
            status: 'entity_resolved' as const,
            resolvedStateEntityId: persistedChild.state_entity_id,
            notes: {
              owner_name: item.ownerNameRaw,
              registry_key: registryKey,
            },
          };
          queryOutcomes.set(queryKey, outcome);
          await applyOwnerOutcome(client, item.ownerRowId, outcome);
          drilldownStats.drilldown_scraped_count += 1;
          drilldownStats.drilldown_resolved_count += 1;

          if (expandedRegistryKeys.has(registryKey)) {
            drilldownStats.drilldown_cycle_skipped_count += 1;
            continue;
          }
          expandedRegistryKeys.add(registryKey);
          enqueueEntityOwners({
            queue,
            owners: persistedChild.owners,
            state: 'FL',
            originCompanyId: companyId,
            parentStateEntityId: persistedChild.state_entity_id,
            stats: drilldownStats,
          });
        }

        const recon = await reconcileCompanyToStateEntity(
          client as unknown as Parameters<typeof reconcileCompanyToStateEntity>[0],
          {
            reconciliationRunId: reconciliationId,
            companyId,
            stateEntityId: state_entity_id,
          },
        );
        perCompany.push({
          companyId,
          state: 'FL',
          state_entity_id,
          root_state_entity_id: state_entity_id,
          ...drilldownStats,
          ...recon,
        });
        if (recon.outcome !== 'error') {
          await noteOutcomePersisted();
        }
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
        await noteOutcomePersisted();
      }
    }
    logRec('company-loop-finished', { processed: companyIds.length });
  } finally {
    logRec('browser-closing', {});
    await browser.close().catch(() => {});
    logRec('browser-closed', {});
  }

  logRec('job-progress-update-start', { jobId: jobIdResolved });
  const { reconciliationOutcomes } = await flushStateMatchingJobOutcomeProgress(
    client as unknown as Parameters<typeof flushStateMatchingJobOutcomeProgress>[0],
    jobIdResolved,
    reconciliationId,
  );
  await patchFoundryJobProgress(
    client as unknown as Parameters<typeof patchFoundryJobProgress>[0],
    jobIdResolved,
    {
      ...mergeStateMatchingOutcomeProgress(undefined, reconciliationOutcomes),
      current_step: 'florida_ecs_done',
      florida_per_company: perCompany,
    },
  );

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
