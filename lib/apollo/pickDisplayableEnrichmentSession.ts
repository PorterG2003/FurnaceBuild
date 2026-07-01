import type { ApolloEnrichmentSessionRow } from './enrichmentSessionTypes';
import { isPendingEnrichmentSession } from './enrichmentSessionTypes';

function hasSyncSuggestion(session: ApolloEnrichmentSessionRow): boolean {
  return session.sync_suggestion != null;
}

function isDisplayableSession(session: ApolloEnrichmentSessionRow): boolean {
  if (isPendingEnrichmentSession(session)) {
    return hasSyncSuggestion(session);
  }
  if (session.status === 'no_match') return true;
  if (session.status === 'complete' || session.status === 'no_phone') {
    return hasSyncSuggestion(session);
  }
  return false;
}

/**
 * Pick the best session to show when opening enrich UI.
 * Input rows must be ordered `created_at DESC` (newest first).
 */
export function pickDisplayableEnrichmentSession(
  sessions: ApolloEnrichmentSessionRow[],
): ApolloEnrichmentSessionRow | null {
  for (const session of sessions) {
    if (isDisplayableSession(session)) {
      return session;
    }
  }
  return null;
}

/** Whether a lead has any session worth opening the enrich panel for. */
export function hasDisplayableEnrichmentSession(
  sessions: ApolloEnrichmentSessionRow[],
): boolean {
  return pickDisplayableEnrichmentSession(sessions) != null;
}
