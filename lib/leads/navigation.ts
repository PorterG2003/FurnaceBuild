import { getLeadById } from '@/lib/supabase/services/leads';

export type LeadDetailFrom = 'explorer' | 'list' | 'campaign' | 'inbox';

export interface OpenLeadDetailParams {
  globalLeadId?: string;
  leadId?: string;
  campaignId?: string;
  from?: LeadDetailFrom;
  listId?: string;
  listName?: string;
  campaignName?: string;
  threadId?: string;
}

type RouterLike = {
  push: (href: string) => void;
};

export async function resolveGlobalLeadId(
  params: Pick<OpenLeadDetailParams, 'globalLeadId' | 'leadId'>,
): Promise<string | null> {
  if (params.globalLeadId) {
    return params.globalLeadId;
  }
  if (params.leadId) {
    const lead = await getLeadById(params.leadId);
    return lead?.global_lead_id ?? null;
  }
  return null;
}

export function buildLeadDetailPath(params: OpenLeadDetailParams & { globalLeadId: string }): string {
  const query = new URLSearchParams();
  if (params.campaignId) query.set('campaignId', params.campaignId);
  if (params.from) query.set('from', params.from);
  if (params.listId) query.set('listId', params.listId);
  if (params.listName) query.set('listName', params.listName);
  if (params.campaignName) query.set('campaignName', params.campaignName);
  if (params.threadId) query.set('threadId', params.threadId);
  const qs = query.toString();
  return `/leads/${params.globalLeadId}${qs ? `?${qs}` : ''}`;
}

export async function openLeadDetail(router: RouterLike, params: OpenLeadDetailParams): Promise<void> {
  const globalLeadId = await resolveGlobalLeadId(params);
  if (!globalLeadId) return;
  router.push(buildLeadDetailPath({ ...params, globalLeadId }));
}
