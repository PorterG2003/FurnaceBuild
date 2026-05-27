import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types/supabase-client-database';
import { invalidRequest } from './errors.js';

export type ApiCampaignTag = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
};

type Supabase = SupabaseClient<Database>;

export async function listAccountCampaignTags(
  supabase: Supabase,
  accountId: string,
): Promise<ApiCampaignTag[]> {
  const { data, error } = await supabase
    .from('campaign_tags')
    .select('id, name, color, created_at')
    .eq('account_id', accountId)
    .order('name');
  if (error) throw new Error(`Failed to list campaign tags: ${error.message}`);
  return data ?? [];
}

export async function getTagsForCampaignIds(
  supabase: Supabase,
  campaignIds: string[],
): Promise<Record<string, ApiCampaignTag[]>> {
  const result: Record<string, ApiCampaignTag[]> = {};
  for (const id of campaignIds) result[id] = [];
  if (campaignIds.length === 0) return result;

  const { data: assignments, error: assignError } = await supabase
    .from('campaign_tag_assignments')
    .select('campaign_id, tag_id')
    .in('campaign_id', campaignIds);
  if (assignError) throw new Error(`Failed to fetch campaign tag assignments: ${assignError.message}`);

  const tagIds = [...new Set((assignments ?? []).map((a) => a.tag_id))];
  if (tagIds.length === 0) return result;

  const { data: tags, error: tagsError } = await supabase
    .from('campaign_tags')
    .select('id, name, color, created_at')
    .in('id', tagIds);
  if (tagsError) throw new Error(`Failed to fetch campaign tags: ${tagsError.message}`);

  const tagMap = new Map((tags ?? []).map((t) => [t.id, t]));
  for (const a of assignments ?? []) {
    const tag = tagMap.get(a.tag_id);
    if (tag && result[a.campaign_id]) result[a.campaign_id].push(tag);
  }
  for (const id of campaignIds) {
    result[id].sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

export async function validateCampaignTagIdsForAccount(
  supabase: Supabase,
  accountId: string,
  tagIds: string[],
): Promise<void> {
  const unique = [...new Set(tagIds.filter(Boolean))];
  if (unique.length === 0) return;
  const { data, error } = await supabase
    .from('campaign_tags')
    .select('id')
    .eq('account_id', accountId)
    .in('id', unique);
  if (error) throw new Error(`Failed to validate campaign tags: ${error.message}`);
  if ((data ?? []).length !== unique.length) {
    invalidRequest('invalid_tag_ids', 'One or more tag ids are invalid for this account');
  }
}

export async function applyCampaignTagPatch(
  supabase: Supabase,
  accountId: string,
  campaignId: string,
  patch: {
    tag_ids?: string[];
    add_tag_ids?: string[];
    remove_tag_ids?: string[];
  },
): Promise<void> {
  if (patch.tag_ids !== undefined) {
    await validateCampaignTagIdsForAccount(supabase, accountId, patch.tag_ids);
    const { error: deleteError } = await supabase
      .from('campaign_tag_assignments')
      .delete()
      .eq('campaign_id', campaignId);
    if (deleteError) throw new Error(`Failed to clear campaign tags: ${deleteError.message}`);
    const unique = [...new Set(patch.tag_ids)];
    if (unique.length > 0) {
      const { error: insertError } = await supabase.from('campaign_tag_assignments').insert(
        unique.map((tagId) => ({ campaign_id: campaignId, tag_id: tagId, account_id: accountId })),
      );
      if (insertError) throw new Error(`Failed to set campaign tags: ${insertError.message}`);
    }
    return;
  }

  if (patch.add_tag_ids?.length) {
    await validateCampaignTagIdsForAccount(supabase, accountId, patch.add_tag_ids);
    const unique = [...new Set(patch.add_tag_ids)];
    const { data: existing } = await supabase
      .from('campaign_tag_assignments')
      .select('tag_id')
      .eq('campaign_id', campaignId)
      .in('tag_id', unique);
    const existingSet = new Set((existing ?? []).map((r) => r.tag_id));
    const toInsert = unique.filter((id) => !existingSet.has(id));
    if (toInsert.length > 0) {
      const { error } = await supabase.from('campaign_tag_assignments').insert(
        toInsert.map((tagId) => ({ campaign_id: campaignId, tag_id: tagId, account_id: accountId })),
      );
      if (error) throw new Error(`Failed to add campaign tags: ${error.message}`);
    }
  }

  if (patch.remove_tag_ids?.length) {
    const unique = [...new Set(patch.remove_tag_ids)];
    const { error } = await supabase
      .from('campaign_tag_assignments')
      .delete()
      .eq('campaign_id', campaignId)
      .in('tag_id', unique);
    if (error) throw new Error(`Failed to remove campaign tags: ${error.message}`);
  }
}

export async function getCampaignIdsMatchingAnyTag(
  supabase: Supabase,
  accountId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const { data, error } = await supabase
    .from('campaign_tag_assignments')
    .select('campaign_id')
    .eq('account_id', accountId)
    .in('tag_id', tagIds);
  if (error) throw new Error(`Failed to filter campaigns by tag: ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.campaign_id))];
}

export function attachTagsToCampaignRow<T extends Record<string, unknown>>(
  row: T,
  tagsMap: Record<string, ApiCampaignTag[]>,
): T & { tags: ApiCampaignTag[] } {
  const id = typeof row.id === 'string' ? row.id : '';
  return { ...row, tags: tagsMap[id] ?? [] };
}
