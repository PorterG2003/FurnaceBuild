import type { ApolloProfileSuggestion } from './mapApolloToProfile';
import type { ApolloPhoneNumber } from './apolloClient';

/** Session status values stored in apollo_enrichment_sessions.status */
export type ApolloEnrichmentSessionStatus =
  | 'pending_phone'
  | 'complete'
  | 'no_phone'
  | 'no_match'
  | 'failed'
  | 'expired';

/** How long a pending_phone session blocks re-enrich (minutes). */
export const APOLLO_ENRICHMENT_SESSION_EXPIRY_MINUTES = 15;

export type EnrichmentProviderSource = 'apollo' | 'prospeo';

export interface ApolloEnrichmentSessionRow {
  id: string;
  account_id: string;
  global_lead_id: string;
  created_by: string | null;
  status: ApolloEnrichmentSessionStatus;
  sync_suggestion: ApolloProfileSuggestion | null;
  phone_numbers: ApolloPhoneNumber[] | null;
  profile_source: EnrichmentProviderSource | null;
  phone_source: EnrichmentProviderSource | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export function isPendingEnrichmentSession(session: Pick<ApolloEnrichmentSessionRow, 'status' | 'expires_at'>): boolean {
  if (session.status !== 'pending_phone') return false;
  return new Date(session.expires_at).getTime() > Date.now();
}

export function isTerminalEnrichmentSession(status: ApolloEnrichmentSessionStatus): boolean {
  return status !== 'pending_phone';
}
