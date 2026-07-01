import { supabase } from '../supabase/client';
import type { CreditMeter } from './meters';

export interface CreditBalance {
  /** Credits consumed this period (grant - remaining). */
  used: number;
  /** Credits left this period. */
  remaining: number;
  /** Monthly allowance for this account + meter. */
  limit: number;
}

/**
 * Read the current-period credit balance for an account + meter via the
 * `get_credit_balance` RPC. Generic across all metered features.
 */
export async function getCreditBalance(
  accountId: string,
  meter: CreditMeter,
): Promise<CreditBalance> {
  const { data, error } = await supabase.rpc('get_credit_balance', {
    p_account_id: accountId,
    p_meter: meter,
  });

  if (error) {
    throw new Error(`Failed to read credit balance: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { used: 0, remaining: 0, limit: 0 };
  }

  return {
    used: row.used ?? 0,
    remaining: row.remaining ?? 0,
    limit: row.credit_limit ?? 0,
  };
}

/**
 * Returns the most recent consume timestamp (delta < 0) for a given
 * account + meter + reference, or null if it was never consumed. Used e.g. to
 * warn before re-enriching the same lead. Reads via account-scoped RLS.
 */
export async function getLastConsumedAt(
  accountId: string,
  meter: CreditMeter,
  refType: string,
  refId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('meter', meter)
    .eq('ref_type', refType)
    .eq('ref_id', refId)
    .lt('delta', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read last credit usage: ${error.message}`);
  }

  return data?.created_at ?? null;
}
