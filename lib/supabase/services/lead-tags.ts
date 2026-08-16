import { supabase } from '../client';
import { getTagCreateErrorMessage, getTagUpdateErrorMessage } from '@/lib/tags/errors';

export interface LeadTagGroup {
  id: string;
  account_id: string | null;
  key: string;
  name: string;
  created_at: string;
}

export interface LeadTag {
  id: string;
  account_id: string | null;
  name: string;
  color: string | null;
  group_id: string | null;
  aliases: string[];
  created_at: string;
  group_key: string | null;
  group_name: string | null;
  is_catalog: boolean;
}

type LeadTagRow = {
  id: string;
  account_id: string | null;
  name: string;
  color: string | null;
  group_id: string | null;
  aliases: string[] | null;
  created_at: string;
  lead_tag_groups: { id: string; key: string; name: string } | { id: string; key: string; name: string }[] | null;
};

function mapLeadTag(row: LeadTagRow): LeadTag {
  const group = Array.isArray(row.lead_tag_groups) ? row.lead_tag_groups[0] ?? null : row.lead_tag_groups;
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    color: row.color,
    group_id: row.group_id,
    aliases: row.aliases ?? [],
    created_at: row.created_at,
    group_key: group?.key ?? null,
    group_name: group?.name ?? null,
    is_catalog: row.account_id == null,
  };
}

const TAG_SELECT = 'id, account_id, name, color, group_id, aliases, created_at, lead_tag_groups(id, key, name)';

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

function tagMatchesName(tag: LeadTag, name: string): boolean {
  const normalized = normalizeTagName(name);
  if (!normalized) return false;
  if (normalizeTagName(tag.name) === normalized) return true;
  return tag.aliases.some((alias) => normalizeTagName(alias) === normalized);
}

export async function getLeadTagGroups(accountId: string): Promise<LeadTagGroup[]> {
  const { data, error } = await supabase
    .from('lead_tag_groups')
    .select('*')
    .or(`account_id.is.null,account_id.eq.${accountId}`)
    .order('name');

  if (error) {
    throw new Error(`Failed to fetch lead tag groups: ${error.message}`);
  }

  return (data ?? []) as LeadTagGroup[];
}

export async function getLeadTags(accountId: string): Promise<LeadTag[]> {
  const { data, error } = await supabase
    .from('lead_tags')
    .select(TAG_SELECT)
    .or(`account_id.is.null,account_id.eq.${accountId}`)
    .order('name');

  if (error) {
    throw new Error(`Failed to fetch lead tags: ${error.message}`);
  }

  return ((data ?? []) as LeadTagRow[]).map(mapLeadTag);
}

export async function createLeadTag(
  accountId: string,
  params: { name: string; color?: string | null; groupId?: string | null },
): Promise<LeadTag> {
  const existing = await findLeadTagByName(accountId, params.name);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('lead_tags')
    .insert({
      account_id: accountId,
      name: params.name.trim(),
      color: params.color ?? null,
      group_id: params.groupId ?? null,
    })
    .select(TAG_SELECT)
    .single();

  if (error) {
    throw new Error(getTagCreateErrorMessage(error, params.name));
  }

  return mapLeadTag(data as LeadTagRow);
}

export async function findLeadTagByName(accountId: string, name: string): Promise<LeadTag | null> {
  const tags = await getLeadTags(accountId);
  return tags.find((tag) => tagMatchesName(tag, name)) ?? null;
}

export async function findOrCreateLeadTagByName(
  accountId: string,
  name: string,
  params?: { color?: string | null },
): Promise<LeadTag | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await findLeadTagByName(accountId, trimmed);
  if (existing) return existing;
  return createLeadTag(accountId, { name: trimmed, color: params?.color ?? null });
}

export async function updateLeadTag(
  tagId: string,
  params: { color?: string | null; name?: string },
): Promise<LeadTag> {
  const { data: existing, error: existingError } = await supabase
    .from('lead_tags')
    .select(TAG_SELECT)
    .eq('id', tagId)
    .single();
  if (existingError || !existing) {
    throw new Error('Tag not found');
  }
  const current = mapLeadTag(existing as LeadTagRow);
  if (current.is_catalog) {
    throw new Error('Built-in catalog tags cannot be edited.');
  }

  const updates: { color?: string | null; name?: string } = {};
  if (params.color !== undefined) updates.color = params.color;
  if (params.name !== undefined) updates.name = params.name.trim();
  if (Object.keys(updates).length === 0) return current;

  const { data, error } = await supabase
    .from('lead_tags')
    .update(updates)
    .eq('id', tagId)
    .select(TAG_SELECT)
    .single();

  if (error) {
    throw new Error(getTagUpdateErrorMessage(error, params.name));
  }

  return mapLeadTag(data as LeadTagRow);
}

export async function deleteLeadTag(tagId: string): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from('lead_tags')
    .select('account_id')
    .eq('id', tagId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to delete lead tag: ${existingError.message}`);
  }
  if (!existing) return;
  if (existing.account_id == null) {
    throw new Error('Built-in catalog tags cannot be deleted.');
  }

  const { error } = await supabase.from('lead_tags').delete().eq('id', tagId);
  if (error) {
    throw new Error(`Failed to delete lead tag: ${error.message}`);
  }
}

export async function addTagToPerson(accountId: string, globalLeadId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from('lead_tag_assignments').insert({
    account_id: accountId,
    global_lead_id: globalLeadId,
    tag_id: tagId,
  });
  if (error && error.code !== '23505') {
    throw new Error(`Failed to add tag to person: ${error.message}`);
  }
}

export async function removeTagFromPerson(accountId: string, globalLeadId: string, tagId: string): Promise<void> {
  const { error } = await supabase
    .from('lead_tag_assignments')
    .delete()
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .eq('tag_id', tagId);

  if (error) {
    throw new Error(`Failed to remove tag from person: ${error.message}`);
  }
}

export async function setPersonLeadTags(
  accountId: string,
  globalLeadId: string,
  tagIds: string[],
): Promise<void> {
  const uniqueTagIds = [...new Set(tagIds.filter(Boolean))];

  const { error: deleteError } = await supabase
    .from('lead_tag_assignments')
    .delete()
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId);
  if (deleteError) {
    throw new Error(`Failed to clear person tags: ${deleteError.message}`);
  }

  if (uniqueTagIds.length === 0) return;

  const { error: insertError } = await supabase.from('lead_tag_assignments').insert(
    uniqueTagIds.map((tagId) => ({
      account_id: accountId,
      global_lead_id: globalLeadId,
      tag_id: tagId,
    })),
  );
  if (insertError) {
    throw new Error(`Failed to set person tags: ${insertError.message}`);
  }
}

export async function addTagsToPerson(
  accountId: string,
  globalLeadId: string,
  tagIds: string[],
): Promise<void> {
  const uniqueTagIds = [...new Set(tagIds.filter(Boolean))];
  if (uniqueTagIds.length === 0) return;

  const { data: existing } = await supabase
    .from('lead_tag_assignments')
    .select('tag_id')
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .in('tag_id', uniqueTagIds);

  const existingSet = new Set((existing ?? []).map((row) => row.tag_id));
  const toInsert = uniqueTagIds.filter((id) => !existingSet.has(id));
  if (toInsert.length === 0) return;

  const { error } = await supabase.from('lead_tag_assignments').insert(
    toInsert.map((tagId) => ({
      account_id: accountId,
      global_lead_id: globalLeadId,
      tag_id: tagId,
    })),
  );
  if (error) {
    throw new Error(`Failed to add tags to person: ${error.message}`);
  }
}

export async function removeTagsFromPerson(
  accountId: string,
  globalLeadId: string,
  tagIds: string[],
): Promise<void> {
  const uniqueTagIds = [...new Set(tagIds.filter(Boolean))];
  if (uniqueTagIds.length === 0) return;

  const { error } = await supabase
    .from('lead_tag_assignments')
    .delete()
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .in('tag_id', uniqueTagIds);

  if (error) {
    throw new Error(`Failed to remove tags from person: ${error.message}`);
  }
}

export async function getTagsForPerson(accountId: string, globalLeadId: string): Promise<LeadTag[]> {
  const { data: assignments, error: assignError } = await supabase
    .from('lead_tag_assignments')
    .select('tag_id')
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId);

  if (assignError) {
    throw new Error(`Failed to fetch lead tag assignments: ${assignError.message}`);
  }

  const tagIds = (assignments ?? []).map((a) => a.tag_id);
  if (tagIds.length === 0) return [];

  const { data: tags, error: tagsError } = await supabase
    .from('lead_tags')
    .select(TAG_SELECT)
    .in('id', tagIds)
    .order('name');

  if (tagsError) {
    throw new Error(`Failed to fetch lead tags: ${tagsError.message}`);
  }

  return ((tags ?? []) as LeadTagRow[]).map(mapLeadTag);
}

export async function getTagsForPeople(
  accountId: string,
  globalLeadIds: string[],
): Promise<Record<string, LeadTag[]>> {
  const result: Record<string, LeadTag[]> = {};
  for (const id of globalLeadIds) {
    result[id] = [];
  }
  if (globalLeadIds.length === 0) return result;

  const { data: assignments, error: assignError } = await supabase
    .from('lead_tag_assignments')
    .select('global_lead_id, tag_id')
    .eq('account_id', accountId)
    .in('global_lead_id', globalLeadIds);

  if (assignError) {
    throw new Error(`Failed to fetch lead tag assignments: ${assignError.message}`);
  }

  const tagIds = [...new Set((assignments ?? []).map((a) => a.tag_id))];
  if (tagIds.length === 0) return result;

  const { data: tags, error: tagsError } = await supabase
    .from('lead_tags')
    .select(TAG_SELECT)
    .in('id', tagIds);

  if (tagsError) {
    throw new Error(`Failed to fetch lead tags: ${tagsError.message}`);
  }

  const tagMap = new Map<string, LeadTag>(((tags ?? []) as LeadTagRow[]).map((t) => [t.id, mapLeadTag(t)]));
  for (const a of assignments ?? []) {
    const tag = tagMap.get(a.tag_id);
    if (tag && result[a.global_lead_id]) {
      result[a.global_lead_id].push(tag);
    }
  }

  for (const id of globalLeadIds) {
    result[id].sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

export async function getGlobalLeadIdsForTags(accountId: string, tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];

  const { data, error } = await supabase
    .from('lead_tag_assignments')
    .select('global_lead_id')
    .eq('account_id', accountId)
    .in('tag_id', tagIds);

  if (error) {
    throw new Error(`Failed to fetch people for tags: ${error.message}`);
  }

  return [...new Set((data ?? []).map((row) => row.global_lead_id))];
}

export async function validateLeadTagIds(accountId: string, tagIds: string[]): Promise<void> {
  const unique = [...new Set(tagIds.filter(Boolean))];
  if (unique.length === 0) return;

  const { data, error } = await supabase
    .from('lead_tags')
    .select('id')
    .or(`account_id.is.null,account_id.eq.${accountId}`)
    .in('id', unique);

  if (error) {
    throw new Error(`Failed to validate lead tags: ${error.message}`);
  }

  if ((data ?? []).length !== unique.length) {
    throw new Error('One or more tag ids are invalid for this account');
  }
}
