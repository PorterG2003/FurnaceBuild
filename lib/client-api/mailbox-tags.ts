import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types/supabase-client-database';
import { invalidRequest } from './errors.js';

export type ApiMailboxTag = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
};

type Supabase = SupabaseClient<Database>;

export async function listAccountMailboxTags(
  supabase: Supabase,
  accountId: string,
): Promise<ApiMailboxTag[]> {
  const { data, error } = await supabase
    .from('mailbox_tags')
    .select('id, name, color, created_at')
    .eq('account_id', accountId)
    .order('name');
  if (error) throw new Error(`Failed to list mailbox tags: ${error.message}`);
  return data ?? [];
}

export async function getTagsForMailboxIds(
  supabase: Supabase,
  mailboxIds: string[],
): Promise<Record<string, ApiMailboxTag[]>> {
  const result: Record<string, ApiMailboxTag[]> = {};
  for (const id of mailboxIds) result[id] = [];
  if (mailboxIds.length === 0) return result;

  const { data: assignments, error: assignError } = await supabase
    .from('mailbox_tag_assignments')
    .select('mailbox_id, tag_id')
    .in('mailbox_id', mailboxIds);
  if (assignError) throw new Error(`Failed to fetch mailbox tag assignments: ${assignError.message}`);

  const tagIds = [...new Set((assignments ?? []).map((assignment) => assignment.tag_id))];
  if (tagIds.length === 0) return result;

  const { data: tags, error: tagsError } = await supabase
    .from('mailbox_tags')
    .select('id, name, color, created_at')
    .in('id', tagIds);
  if (tagsError) throw new Error(`Failed to fetch mailbox tags: ${tagsError.message}`);

  const tagMap = new Map((tags ?? []).map((tag) => [tag.id, tag]));
  for (const assignment of assignments ?? []) {
    const tag = tagMap.get(assignment.tag_id);
    if (tag && result[assignment.mailbox_id]) result[assignment.mailbox_id].push(tag);
  }
  for (const id of mailboxIds) {
    result[id].sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

export async function validateMailboxTagIdsForAccount(
  supabase: Supabase,
  accountId: string,
  tagIds: string[],
): Promise<void> {
  const unique = [...new Set(tagIds.filter(Boolean))];
  if (unique.length === 0) return;
  const { data, error } = await supabase
    .from('mailbox_tags')
    .select('id')
    .eq('account_id', accountId)
    .in('id', unique);
  if (error) throw new Error(`Failed to validate mailbox tags: ${error.message}`);
  if ((data ?? []).length !== unique.length) {
    invalidRequest('invalid_tag_ids', 'One or more tag ids are invalid for this account');
  }
}

export async function applyMailboxTagPatch(
  supabase: Supabase,
  accountId: string,
  mailboxId: string,
  patch: {
    tag_ids?: string[];
    add_tag_ids?: string[];
    remove_tag_ids?: string[];
  },
): Promise<void> {
  if (patch.tag_ids !== undefined) {
    await validateMailboxTagIdsForAccount(supabase, accountId, patch.tag_ids);
    const { error: deleteError } = await supabase
      .from('mailbox_tag_assignments')
      .delete()
      .eq('mailbox_id', mailboxId);
    if (deleteError) throw new Error(`Failed to clear mailbox tags: ${deleteError.message}`);
    const unique = [...new Set(patch.tag_ids)];
    if (unique.length > 0) {
      const { error: insertError } = await supabase.from('mailbox_tag_assignments').insert(
        unique.map((tagId) => ({ mailbox_id: mailboxId, tag_id: tagId, account_id: accountId })),
      );
      if (insertError) throw new Error(`Failed to set mailbox tags: ${insertError.message}`);
    }
    return;
  }

  if (patch.add_tag_ids?.length) {
    await validateMailboxTagIdsForAccount(supabase, accountId, patch.add_tag_ids);
    const unique = [...new Set(patch.add_tag_ids)];
    const { data: existing } = await supabase
      .from('mailbox_tag_assignments')
      .select('tag_id')
      .eq('mailbox_id', mailboxId)
      .in('tag_id', unique);
    const existingSet = new Set((existing ?? []).map((row) => row.tag_id));
    const toInsert = unique.filter((id) => !existingSet.has(id));
    if (toInsert.length > 0) {
      const { error } = await supabase.from('mailbox_tag_assignments').insert(
        toInsert.map((tagId) => ({ mailbox_id: mailboxId, tag_id: tagId, account_id: accountId })),
      );
      if (error) throw new Error(`Failed to add mailbox tags: ${error.message}`);
    }
  }

  if (patch.remove_tag_ids?.length) {
    const unique = [...new Set(patch.remove_tag_ids)];
    const { error } = await supabase
      .from('mailbox_tag_assignments')
      .delete()
      .eq('mailbox_id', mailboxId)
      .in('tag_id', unique);
    if (error) throw new Error(`Failed to remove mailbox tags: ${error.message}`);
  }
}

export async function getMailboxIdsMatchingAnyTag(
  supabase: Supabase,
  accountId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const { data, error } = await supabase
    .from('mailbox_tag_assignments')
    .select('mailbox_id')
    .eq('account_id', accountId)
    .in('tag_id', tagIds);
  if (error) throw new Error(`Failed to filter mailboxes by tag: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.mailbox_id))];
}

export function attachTagsToMailboxRow<T extends Record<string, unknown>>(
  row: T,
  tagsMap: Record<string, ApiMailboxTag[]>,
): T & { tags: ApiMailboxTag[] } {
  const id = typeof row.id === 'string' ? row.id : '';
  return { ...row, tags: tagsMap[id] ?? [] };
}
