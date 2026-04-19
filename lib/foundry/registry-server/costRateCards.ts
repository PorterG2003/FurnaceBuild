import type { SupabaseClient } from '@supabase/supabase-js';

export type CostKind = 'acquisition' | 'enrichment';
export type CostUsageUnit = 'row' | 'lookup' | 'ms' | 'allocated_row' | string;
export type CostRecordKind = 'direct' | 'allocated';
export type CostStatus = 'costed' | 'failed_or_not_costed' | 'pre_cost_implementation_or_not_backfilled';

export type CurrentRateCard = {
  id: string;
  unitPriceCents: number;
  usageUnit: string;
  unitQuantity: number;
};

export type ResolvedRunCost = {
  unitPriceCents: number;
  rateCardId: string | null;
  isOverride: boolean;
  usageUnit: string;
  unitQuantity: number;
};

/**
 * Look up the active rate card for a (kind, provider, product) tuple.
 * Picks the row with latest effective_from where effective_from <= now and (effective_to is null or > now).
 */
export async function lookupCurrentRate(
  client: SupabaseClient,
  costKind: CostKind,
  provider: string,
  product: string,
): Promise<CurrentRateCard | null> {
  const { data, error } = await client
    .from('cost_rate_cards')
    .select('id, unit_price_cents, usage_unit, unit_quantity, effective_from')
    .eq('cost_kind', costKind)
    .eq('provider', provider)
    .eq('product', product)
    .is('effective_to', null)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('lookupCurrentRate failed', error.message);
    return null;
  }
  if (!data || typeof data.id !== 'string') return null;
  const cents = data.unit_price_cents;
  const usageUnit = data.usage_unit;
  const unitQuantity = data.unit_quantity;
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) return null;
  if (typeof usageUnit !== 'string' || usageUnit.trim() === '') return null;
  if (typeof unitQuantity !== 'number' || !Number.isFinite(unitQuantity) || unitQuantity <= 0) return null;
  return {
    id: data.id,
    unitPriceCents: Math.trunc(cents),
    usageUnit: usageUnit.trim(),
    unitQuantity: Math.max(1, Math.trunc(unitQuantity)),
  };
}

/**
 * Resolve cost for a run: use override if provided (still records active rate card id when lookup succeeds for audit).
 */
export async function resolveRunCost(
  client: SupabaseClient,
  costKind: CostKind,
  provider: string,
  product: string,
  userOverrideCents?: number | null,
  options?: { usageUnit?: CostUsageUnit; unitQuantity?: number | null },
): Promise<ResolvedRunCost | null> {
  const baseline = await lookupCurrentRate(client, costKind, provider, product);

  if (userOverrideCents != null && Number.isFinite(userOverrideCents)) {
    const v = Math.max(0, Math.trunc(userOverrideCents));
    const overrideUsageUnit = baseline?.usageUnit ?? options?.usageUnit;
    const overrideUnitQuantity = baseline?.unitQuantity ?? options?.unitQuantity ?? 1;
    if (!overrideUsageUnit || !Number.isFinite(overrideUnitQuantity) || overrideUnitQuantity <= 0) {
      return null;
    }
    return {
      unitPriceCents: v,
      rateCardId: baseline?.id ?? null,
      isOverride: true,
      usageUnit: String(overrideUsageUnit),
      unitQuantity: Math.max(1, Math.trunc(overrideUnitQuantity)),
    };
  }

  if (!baseline) return null;
  return {
    unitPriceCents: baseline.unitPriceCents,
    rateCardId: baseline.id,
    isOverride: false,
    usageUnit: baseline.usageUnit,
    unitQuantity: baseline.unitQuantity,
  };
}

export function computeCostAmountMicros(params: {
  usageQuantity: number;
  unitPriceCents: number;
  unitQuantity?: number | null;
}): number {
  const usageQuantity = Math.max(0, Math.trunc(params.usageQuantity));
  const unitPriceCents = Math.max(0, Math.trunc(params.unitPriceCents));
  const unitQuantity = Math.max(1, Math.trunc(params.unitQuantity ?? 1));
  return Math.round((usageQuantity * unitPriceCents * 10000) / unitQuantity);
}

export function computeRoundedCentsFromMicros(costAmountMicros: number): number {
  return Math.max(0, Math.round(costAmountMicros / 10000));
}

export type DirectCostRecordInsert = {
  costKind: CostKind;
  provider: string;
  product: string;
  usageQuantity: number;
  usageUnit: CostUsageUnit;
  costAmountMicros: number;
  costRateCardId?: string | null;
  costIsOverride?: boolean;
  estimationKind?: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  companyId?: string | null;
  ingestionRunId?: string | null;
  foundryJobId?: string | null;
  reconciliationRunId?: string | null;
  parentCostRecordId?: string | null;
  allocationMethod?: string | null;
  meta?: Record<string, unknown>;
  createdAt?: string;
};

export async function insertDirectCostRecord(
  client: SupabaseClient,
  params: DirectCostRecordInsert,
): Promise<{ id: string; costAmountMicros: number; costAmountCents: number }> {
  const usageQuantity = Math.max(0, Math.trunc(params.usageQuantity));
  const costAmountMicros = Math.max(0, Math.round(params.costAmountMicros));
  const { data, error } = await client
    .from('cost_records')
    .insert({
      cost_kind: params.costKind,
      provider: params.provider,
      product: params.product,
      usage_quantity: usageQuantity,
      usage_unit: params.usageUnit,
      cost_amount_micros: costAmountMicros,
      currency: 'USD',
      cost_rate_card_id: params.costRateCardId ?? null,
      cost_is_override: params.costIsOverride === true,
      record_kind: 'direct' satisfies CostRecordKind,
      estimation_kind: params.estimationKind ?? null,
      source_entity_type: params.sourceEntityType,
      source_entity_id: params.sourceEntityId,
      company_id: params.companyId ?? null,
      ingestion_run_id: params.ingestionRunId ?? null,
      foundry_job_id: params.foundryJobId ?? null,
      reconciliation_run_id: params.reconciliationRunId ?? null,
      parent_cost_record_id: params.parentCostRecordId ?? null,
      allocation_method: params.allocationMethod ?? null,
      meta: params.meta ?? {},
      created_at: params.createdAt ?? new Date().toISOString(),
    })
    .select('id, cost_amount_micros, cost_amount_cents')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to insert cost record');
  }
  return {
    id: String(data.id),
    costAmountMicros: Number(data.cost_amount_micros ?? costAmountMicros),
    costAmountCents: Number(data.cost_amount_cents ?? computeRoundedCentsFromMicros(costAmountMicros)),
  };
}
