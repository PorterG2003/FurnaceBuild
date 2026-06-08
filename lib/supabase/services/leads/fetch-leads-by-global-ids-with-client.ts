import type { SupabaseClient } from '@supabase/supabase-js';

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

export type LeadRowByGlobalId = {
  id: string;
  campaign_id: string;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  website: string | null;
  linkedin_url: string | null;
  phone_number: string | null;
  custom_lead_data: Record<string, string | number | null> | null;
  global_lead_id: string | null;
  created_at: string;
};

/** Server-safe fetch helper; does not import the Expo Supabase client. */
export async function fetchLeadsByGlobalLeadIdsWithClient(
  db: SupabaseClient,
  accountId: string,
  globalLeadIds: string[],
): Promise<LeadRowByGlobalId[]> {
  const rows: LeadRowByGlobalId[] = [];
  for (const idChunk of chunk(unique(globalLeadIds))) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await db
        .from('leads')
        .select(
          'id, campaign_id, email, name, first_name, last_name, company_name, website, linkedin_url, phone_number, custom_lead_data, global_lead_id, created_at',
        )
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .in('global_lead_id', idChunk)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch list members: ${error.message}`);
      }

      const pageRows = (data ?? []) as LeadRowByGlobalId[];
      rows.push(...pageRows);
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }
  return rows;
}
