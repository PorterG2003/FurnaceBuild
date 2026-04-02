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
  const [reconciliationOutcomes, jobResult] = await Promise.all([
    getReconciliationOutcomeCounts(leadsClient, reconciliationRunId),
    leadsClient.from('foundry_jobs').select('progress').eq('id', jobId).maybeSingle(),
  ]);

  if (jobResult.error) {
    throw new Error(jobResult.error.message);
  }

  const progress = mergeStateMatchingOutcomeProgress(
    (jobResult.data?.progress ?? {}) as Record<string, unknown>,
    reconciliationOutcomes,
  );
  const { error: updateErr } = await leadsClient
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress,
    })
    .eq('id', jobId);
  if (updateErr) {
    throw new Error(updateErr.message);
  }

  return {
    reconciliationOutcomes,
    companiesWithResult: sumReconciliationOutcomeCounts(reconciliationOutcomes),
  };
}
