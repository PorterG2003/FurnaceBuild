export {
  fetchLeadsByGlobalLeadIdsWithClient,
  type LeadRowByGlobalId,
} from './fetch-leads-by-global-ids-with-client';

const POSTGREST_IN_CHUNK_SIZE = 100;
const POSTGREST_RANGE_PAGE_SIZE = 500;

function chunk<T>(values: T[], chunkSize = POSTGREST_IN_CHUNK_SIZE): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export async function fetchLeadsByGlobalLeadIds(
  accountId: string,
  globalLeadIds: string[],
): Promise<import('./fetch-leads-by-global-ids-with-client').LeadRowByGlobalId[]> {
  const { supabase } = await import('../../client');
  const { fetchLeadsByGlobalLeadIdsWithClient } = await import('./fetch-leads-by-global-ids-with-client');
  return fetchLeadsByGlobalLeadIdsWithClient(supabase, accountId, globalLeadIds);
}

export async function fetchLeadIdsByGlobalLeadIdsIncludingDeleted(
  accountId: string,
  globalLeadIds: string[],
): Promise<string[]> {
  const { supabase } = await import('../../client');
  const leadIds: string[] = [];
  for (const idChunk of chunk(unique(globalLeadIds))) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('leads')
        .select('id')
        .eq('account_id', accountId)
        .in('global_lead_id', idChunk)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch lead ids: ${error.message}`);
      }

      const pageRows = (data ?? []) as { id: string }[];
      leadIds.push(...pageRows.map((row) => row.id));
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }
  return unique(leadIds);
}
