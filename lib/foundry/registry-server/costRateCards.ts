import type { SupabaseClient } from '@supabase/supabase-js';

export type CostKind = 'acquisition' | 'enrichment';

export type ResolvedRunCost = {
  unitPriceCents: number;
  rateCardId: string | null;
  isOverride: boolean;
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
): Promise<{ id: string; unitPriceCents: number } | null> {
  const { data, error } = await client
    .from('cost_rate_cards')
    .select('id, unit_price_cents, effective_from')
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
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) return null;
  return { id: data.id, unitPriceCents: Math.trunc(cents) };
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
): Promise<ResolvedRunCost | null> {
  const baseline = await lookupCurrentRate(client, costKind, provider, product);

  if (userOverrideCents != null && Number.isFinite(userOverrideCents)) {
    const v = Math.max(0, Math.trunc(userOverrideCents));
    return {
      unitPriceCents: v,
      rateCardId: baseline?.id ?? null,
      isOverride: true,
    };
  }

  if (!baseline) return null;
  return {
    unitPriceCents: baseline.unitPriceCents,
    rateCardId: baseline.id,
    isOverride: false,
  };
}
