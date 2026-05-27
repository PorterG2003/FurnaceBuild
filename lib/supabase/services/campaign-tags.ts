import { supabase } from '../client';

export interface CampaignTag {
  id: string;
  account_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface CampaignTagAssignment {
  campaign_id: string;
  tag_id: string;
  account_id: string;
  created_at: string;
}

export async function getCampaignTags(accountId: string): Promise<CampaignTag[]> {
  const { data, error } = await supabase
    .from('campaign_tags')
    .select('*')
    .eq('account_id', accountId)
    .order('name');

  if (error) {
    throw new Error(`Failed to fetch campaign tags: ${error.message}`);
  }

  return data ?? [];
}

export async function createCampaignTag(
  accountId: string,
  params: { name: string; color?: string | null },
): Promise<CampaignTag> {
  const { data, error } = await supabase
    .from('campaign_tags')
    .insert({
      account_id: accountId,
      name: params.name.trim(),
      color: params.color ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create campaign tag: ${error.message}`);
  }

  return data;
}

export async function updateCampaignTag(
  tagId: string,
  params: { color?: string | null; name?: string },
): Promise<CampaignTag> {
  const updates: { color?: string | null; name?: string } = {};
  if (params.color !== undefined) updates.color = params.color;
  if (params.name !== undefined) updates.name = params.name.trim();
  if (Object.keys(updates).length === 0) {
    const { data } = await supabase.from('campaign_tags').select('*').eq('id', tagId).single();
    if (!data) throw new Error('Tag not found');
    return data;
  }
  const { data, error } = await supabase
    .from('campaign_tags')
    .update(updates)
    .eq('id', tagId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update campaign tag: ${error.message}`);
  }

  return data;
}

export async function deleteCampaignTag(tagId: string): Promise<void> {
  const { error } = await supabase.from('campaign_tags').delete().eq('id', tagId);
  if (error) {
    throw new Error(`Failed to delete campaign tag: ${error.message}`);
  }
}

export async function addTagToCampaign(campaignId: string, tagId: string): Promise<void> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('account_id')
    .eq('id', campaignId)
    .single();
  const accountId = campaign?.account_id;
  if (!accountId) throw new Error('Campaign not found or missing account_id');

  const { error } = await supabase.from('campaign_tag_assignments').insert({
    campaign_id: campaignId,
    tag_id: tagId,
    account_id: accountId,
  });

  if (error) {
    throw new Error(`Failed to add tag to campaign: ${error.message}`);
  }
}

export async function removeTagFromCampaign(campaignId: string, tagId: string): Promise<void> {
  const { error } = await supabase
    .from('campaign_tag_assignments')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('tag_id', tagId);

  if (error) {
    throw new Error(`Failed to remove tag from campaign: ${error.message}`);
  }
}

export async function setCampaignTags(campaignId: string, tagIds: string[]): Promise<void> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('account_id')
    .eq('id', campaignId)
    .single();
  const accountId = campaign?.account_id;
  if (!accountId) throw new Error('Campaign not found or missing account_id');

  const uniqueTagIds = [...new Set(tagIds)];

  const { error: deleteError } = await supabase
    .from('campaign_tag_assignments')
    .delete()
    .eq('campaign_id', campaignId);
  if (deleteError) {
    throw new Error(`Failed to clear campaign tags: ${deleteError.message}`);
  }

  if (uniqueTagIds.length === 0) return;

  const { error: insertError } = await supabase.from('campaign_tag_assignments').insert(
    uniqueTagIds.map((tagId) => ({
      campaign_id: campaignId,
      tag_id: tagId,
      account_id: accountId,
    })),
  );
  if (insertError) {
    throw new Error(`Failed to set campaign tags: ${insertError.message}`);
  }
}

export async function addTagsToCampaign(campaignId: string, tagIds: string[]): Promise<void> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('account_id')
    .eq('id', campaignId)
    .single();
  const accountId = campaign?.account_id;
  if (!accountId) throw new Error('Campaign not found or missing account_id');

  const uniqueTagIds = [...new Set(tagIds.filter(Boolean))];
  if (uniqueTagIds.length === 0) return;

  const { data: existing } = await supabase
    .from('campaign_tag_assignments')
    .select('tag_id')
    .eq('campaign_id', campaignId)
    .in('tag_id', uniqueTagIds);

  const existingSet = new Set((existing ?? []).map((row) => row.tag_id));
  const toInsert = uniqueTagIds.filter((id) => !existingSet.has(id));
  if (toInsert.length === 0) return;

  const { error } = await supabase.from('campaign_tag_assignments').insert(
    toInsert.map((tagId) => ({
      campaign_id: campaignId,
      tag_id: tagId,
      account_id: accountId,
    })),
  );
  if (error) {
    throw new Error(`Failed to add tags to campaign: ${error.message}`);
  }
}

export async function removeTagsFromCampaign(campaignId: string, tagIds: string[]): Promise<void> {
  const uniqueTagIds = [...new Set(tagIds.filter(Boolean))];
  if (uniqueTagIds.length === 0) return;

  const { error } = await supabase
    .from('campaign_tag_assignments')
    .delete()
    .eq('campaign_id', campaignId)
    .in('tag_id', uniqueTagIds);

  if (error) {
    throw new Error(`Failed to remove tags from campaign: ${error.message}`);
  }
}

export async function getTagsForCampaign(campaignId: string): Promise<CampaignTag[]> {
  const { data: assignments, error: assignError } = await supabase
    .from('campaign_tag_assignments')
    .select('tag_id')
    .eq('campaign_id', campaignId);

  if (assignError) {
    throw new Error(`Failed to fetch campaign tag assignments: ${assignError.message}`);
  }

  const tagIds = (assignments ?? []).map((a) => a.tag_id);
  if (tagIds.length === 0) return [];

  const { data: tags, error: tagsError } = await supabase
    .from('campaign_tags')
    .select('*')
    .in('id', tagIds)
    .order('name');

  if (tagsError) {
    throw new Error(`Failed to fetch campaign tags: ${tagsError.message}`);
  }

  return tags ?? [];
}

export async function getTagsForCampaigns(
  campaignIds: string[],
): Promise<Record<string, CampaignTag[]>> {
  if (campaignIds.length === 0) return {};

  const { data: assignments, error: assignError } = await supabase
    .from('campaign_tag_assignments')
    .select('campaign_id, tag_id')
    .in('campaign_id', campaignIds);

  if (assignError) {
    throw new Error(`Failed to fetch campaign tag assignments: ${assignError.message}`);
  }

  const tagIds = [...new Set((assignments ?? []).map((a) => a.tag_id))];
  const result: Record<string, CampaignTag[]> = {};
  for (const id of campaignIds) {
    result[id] = [];
  }

  if (tagIds.length === 0) return result;

  const { data: tags, error: tagsError } = await supabase
    .from('campaign_tags')
    .select('*')
    .in('id', tagIds);

  if (tagsError) {
    throw new Error(`Failed to fetch campaign tags: ${tagsError.message}`);
  }

  const tagMap = new Map<string, CampaignTag>((tags ?? []).map((t) => [t.id, t]));
  for (const a of assignments ?? []) {
    const tag = tagMap.get(a.tag_id);
    if (tag && result[a.campaign_id]) {
      result[a.campaign_id].push(tag);
    }
  }

  for (const id of campaignIds) {
    result[id].sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

export async function getCampaignIdsForTags(
  accountId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];

  const { data, error } = await supabase
    .from('campaign_tag_assignments')
    .select('campaign_id')
    .eq('account_id', accountId)
    .in('tag_id', tagIds);

  if (error) {
    throw new Error(`Failed to fetch campaigns for tags: ${error.message}`);
  }

  return [...new Set((data ?? []).map((row) => row.campaign_id))];
}

export async function validateCampaignTagIds(
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

  if (error) {
    throw new Error(`Failed to validate campaign tags: ${error.message}`);
  }

  if ((data ?? []).length !== unique.length) {
    throw new Error('One or more tag ids are invalid for this account');
  }
}
