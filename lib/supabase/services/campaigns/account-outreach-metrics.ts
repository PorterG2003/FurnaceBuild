import { supabase } from '../../client';

/** Row from `account_outreach_metrics` RPC (Furnace-only account rollup). */
export interface AccountOutreachMetrics {
  totalSent: number;
  totalPositiveReply: number;
  leadsReached: number;
  leadsInQueue: number;
  smartleadImportWarning: boolean;
}

type RpcRow = {
  total_sent: number | string | null;
  total_positive_reply: number | string | null;
  leads_reached: number | string | null;
  leads_in_queue: number | string | null;
  smartlead_import_warning: boolean | null;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export async function getAccountOutreachMetrics(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<AccountOutreachMetrics> {
  const { data, error } = await supabase.rpc('account_outreach_metrics', {
    p_account_id: accountId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) {
    throw new Error(`Failed to load account outreach metrics: ${error.message}`);
  }
  const rows = data as RpcRow[] | RpcRow | null;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    return {
      totalSent: 0,
      totalPositiveReply: 0,
      leadsReached: 0,
      leadsInQueue: 0,
      smartleadImportWarning: false,
    };
  }
  return {
    totalSent: num(row.total_sent),
    totalPositiveReply: num(row.total_positive_reply),
    leadsReached: num(row.leads_reached),
    leadsInQueue: num(row.leads_in_queue),
    smartleadImportWarning: row.smartlead_import_warning === true,
  };
}
