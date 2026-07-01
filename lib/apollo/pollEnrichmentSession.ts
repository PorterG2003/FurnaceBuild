import { supabase } from '@/lib/supabase/client';
import type { ApolloEnrichmentSessionRow } from './enrichmentSessionTypes';
import { isPendingEnrichmentSession } from './enrichmentSessionTypes';
import type { ApolloProfileSuggestion } from './mapApolloToProfile';
import type { ApolloPhoneNumber } from './apolloClient';
import { pickDisplayableEnrichmentSession } from './pickDisplayableEnrichmentSession';

export { pickDisplayableEnrichmentSession, hasDisplayableEnrichmentSession } from './pickDisplayableEnrichmentSession';

function mapSessionRow(row: Record<string, unknown>): ApolloEnrichmentSessionRow {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    global_lead_id: String(row.global_lead_id),
    created_by: row.created_by != null ? String(row.created_by) : null,
    status: row.status as ApolloEnrichmentSessionRow['status'],
    sync_suggestion: (row.sync_suggestion as ApolloProfileSuggestion | null) ?? null,
    phone_numbers: (row.phone_numbers as ApolloPhoneNumber[] | null) ?? null,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/** Fetch a single enrichment session by id (RLS: account members only). */
export async function getEnrichmentSession(sessionId: string): Promise<ApolloEnrichmentSessionRow | null> {
  const { data, error } = await supabase
    .from('apollo_enrichment_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;
  return mapSessionRow(data as Record<string, unknown>);
}

/** Latest non-expired pending_phone session for a lead, if any. */
export async function getPendingEnrichmentSession(
  accountId: string,
  globalLeadId: string,
): Promise<ApolloEnrichmentSessionRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('apollo_enrichment_sessions')
    .select('*')
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .eq('status', 'pending_phone')
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;
  const session = mapSessionRow(data as Record<string, unknown>);
  return isPendingEnrichmentSession(session) ? session : null;
}

const DISPLAYABLE_STATUSES = ['pending_phone', 'complete', 'no_phone', 'no_match'] as const;

/** Latest enrichment session worth showing in the enrich UI, if any. */
export async function getLatestEnrichmentSession(
  accountId: string,
  globalLeadId: string,
): Promise<ApolloEnrichmentSessionRow | null> {
  const { data, error } = await supabase
    .from('apollo_enrichment_sessions')
    .select('*')
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .in('status', [...DISPLAYABLE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []).map((row) => mapSessionRow(row as Record<string, unknown>));
  return pickDisplayableEnrichmentSession(rows);
}

export interface PollEnrichmentSessionOptions {
  intervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Poll a session until it leaves pending_phone or the caller aborts.
 * Returns the latest session row on each tick via onUpdate.
 */
export async function pollEnrichmentSession(
  sessionId: string,
  onUpdate: (session: ApolloEnrichmentSessionRow) => void,
  options: PollEnrichmentSessionOptions = {},
): Promise<ApolloEnrichmentSessionRow> {
  const intervalMs = options.intervalMs ?? 2000;

  const pollOnce = async (): Promise<ApolloEnrichmentSessionRow> => {
    const session = await getEnrichmentSession(sessionId);
    if (!session) {
      throw new Error('Enrichment session not found');
    }
    onUpdate(session);
    return session;
  };

  let session = await pollOnce();
  while (isPendingEnrichmentSession(session)) {
    if (options.signal?.aborted) {
      return session;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    if (options.signal?.aborted) {
      return session;
    }
    session = await pollOnce();
  }

  return session;
}
