import { getPendingEnrichmentSession as getPending } from './pollEnrichmentSession';

export { getPendingEnrichmentSession, getLatestEnrichmentSession } from './pollEnrichmentSession';
export type { PollEnrichmentSessionOptions } from './pollEnrichmentSession';

/** Convenience alias used by LeadProfileSection. */
export async function hasPendingEnrichmentSession(
  accountId: string,
  globalLeadId: string,
): Promise<boolean> {
  const session = await getPending(accountId, globalLeadId);
  return session != null;
}
