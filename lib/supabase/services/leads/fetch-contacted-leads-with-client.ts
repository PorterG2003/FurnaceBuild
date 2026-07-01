import type { SupabaseClient } from '@supabase/supabase-js';

const POSTGREST_IN_CHUNK_SIZE = 100;

function chunkIds<T>(ids: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [ids];
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

async function fetchContactedLeadIdsFromEnrollments(
  db: SupabaseClient,
  enrollments: Array<{ id: string; lead_id: string | null }>,
): Promise<Set<string>> {
  const contactedLeadIds = new Set<string>();
  const enrollmentIds = enrollments.map((row) => row.id).filter(Boolean);
  if (enrollmentIds.length === 0) return contactedLeadIds;

  const enrollmentLeadById = new Map<string, string>();
  for (const enrollment of enrollments) {
    if (enrollment.id && enrollment.lead_id) {
      enrollmentLeadById.set(enrollment.id, enrollment.lead_id);
    }
  }

  for (const enrollmentIdChunk of chunkIds(enrollmentIds, POSTGREST_IN_CHUNK_SIZE)) {
    const { data: jobs, error: jobsError } = await db
      .from('message_jobs')
      .select('enrollment_id')
      .in('enrollment_id', enrollmentIdChunk)
      .eq('status', 'sent')
      .or('message_type.eq.campaign,message_type.is.null');

    if (jobsError) {
      throw new Error(`Failed to fetch sent message jobs for contacted lookup: ${jobsError.message}`);
    }

    for (const job of jobs ?? []) {
      const leadId = job.enrollment_id ? enrollmentLeadById.get(job.enrollment_id) : undefined;
      if (leadId) contactedLeadIds.add(leadId);
    }
  }

  return contactedLeadIds;
}

/** Server-safe contacted lookup for campaign-scoped lead ids. */
export async function fetchContactedLeadIdsForLeadsWithClient(
  db: SupabaseClient,
  campaignId: string,
  leadIds: string[],
): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();

  const enrollments: Array<{ id: string; lead_id: string | null }> = [];

  for (const idChunk of chunkIds(leadIds, POSTGREST_IN_CHUNK_SIZE)) {
    const { data: chunk, error: enrollmentsError } = await db
      .from('enrollments')
      .select('id, lead_id')
      .eq('campaign_id', campaignId)
      .is('deleted_at', null)
      .in('lead_id', idChunk);

    if (enrollmentsError) {
      throw new Error(`Failed to fetch enrollments for contacted lookup: ${enrollmentsError.message}`);
    }
    if (chunk?.length) enrollments.push(...chunk);
  }

  return fetchContactedLeadIdsFromEnrollments(db, enrollments);
}

/** Server-safe contacted lookup across campaigns for account lead ids. */
export async function fetchContactedLeadIdsForAccountLeadsWithClient(
  db: SupabaseClient,
  accountId: string,
  leadIds: string[],
): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();

  const enrollments: Array<{ id: string; lead_id: string | null }> = [];

  for (const idChunk of chunkIds(leadIds, POSTGREST_IN_CHUNK_SIZE)) {
    const { data: chunk, error: enrollmentsError } = await db
      .from('enrollments')
      .select('id, lead_id')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .in('lead_id', idChunk);

    if (enrollmentsError) {
      throw new Error(`Failed to fetch enrollments for contacted lookup: ${enrollmentsError.message}`);
    }
    if (chunk?.length) enrollments.push(...chunk);
  }

  return fetchContactedLeadIdsFromEnrollments(db, enrollments);
}
