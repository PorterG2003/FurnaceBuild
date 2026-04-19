import type { SupabaseClient } from '@supabase/supabase-js';

export type ReconciliationOutcomeCounts = Record<string, number>;
type LeadsClient = Pick<SupabaseClient, 'from' | 'rpc'>;

function sanitizeOutcomeCounts(value: unknown): ReconciliationOutcomeCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([key, raw]) => {
    const count = Number(raw);
    if (!Number.isFinite(count) || count < 0) return [];
    return [[key, Math.floor(count)] as const];
  });

  return Object.fromEntries(entries);
}

export function sumReconciliationOutcomeCounts(counts: ReconciliationOutcomeCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function stateMatchingProgressFlushStride(inScopeTotal: number): number {
  const total = Number.isFinite(inScopeTotal) ? Math.max(0, Math.floor(inScopeTotal)) : 0;
  return Math.min(250, Math.max(1, Math.ceil(total * 0.05)));
}

export function mergeStateMatchingOutcomeProgress(
  prev: Record<string, unknown> | null | undefined,
  reconciliationOutcomes: ReconciliationOutcomeCounts,
): Record<string, unknown> {
  return {
    ...(prev ?? {}),
    reconciliation_outcomes: reconciliationOutcomes,
    companies_with_result: sumReconciliationOutcomeCounts(reconciliationOutcomes),
  };
}

export async function patchFoundryJobProgress(
  leadsClient: LeadsClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await leadsClient.rpc('merge_foundry_job_progress', {
    p_job_id: jobId,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
}

export async function getReconciliationOutcomeCounts(
  leadsClient: LeadsClient,
  reconciliationRunId: string,
): Promise<ReconciliationOutcomeCounts> {
  const { data, error } = await leadsClient.rpc('get_reconciliation_outcome_counts', {
    p_run_id: reconciliationRunId,
  });
  if (error) throw new Error(error.message);
  return sanitizeOutcomeCounts(data);
}

export async function flushStateMatchingJobOutcomeProgress(
  leadsClient: LeadsClient,
  jobId: string,
  reconciliationRunId: string,
): Promise<{ reconciliationOutcomes: ReconciliationOutcomeCounts; companiesWithResult: number }> {
  const reconciliationOutcomes = await getReconciliationOutcomeCounts(leadsClient, reconciliationRunId);
  const progressPatch = mergeStateMatchingOutcomeProgress(
    undefined,
    reconciliationOutcomes,
  );
  await patchFoundryJobProgress(leadsClient, jobId, progressPatch);

  return {
    reconciliationOutcomes,
    companiesWithResult: sumReconciliationOutcomeCounts(reconciliationOutcomes),
  };
}
