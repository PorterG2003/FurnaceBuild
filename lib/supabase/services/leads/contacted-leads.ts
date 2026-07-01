import { supabase } from '../../client';
import {
  fetchContactedLeadIdsForAccountLeadsWithClient,
  fetchContactedLeadIdsForLeadsWithClient,
} from './fetch-contacted-leads-with-client';

export async function fetchContactedLeadIdsForLeads(
  campaignId: string,
  leadIds: string[],
): Promise<Set<string>> {
  return fetchContactedLeadIdsForLeadsWithClient(supabase, campaignId, leadIds);
}

export async function fetchContactedLeadIdsForAccountLeads(
  accountId: string,
  leadIds: string[],
): Promise<Set<string>> {
  return fetchContactedLeadIdsForAccountLeadsWithClient(supabase, accountId, leadIds);
}
