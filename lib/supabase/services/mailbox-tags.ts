import { supabase } from '../client';
import type { MailboxTag, MailboxTagAssignment } from '../types';
import { getTagCreateErrorMessage, getTagUpdateErrorMessage } from '@/lib/tags/errors';

export type { MailboxTag, MailboxTagAssignment };

export async function getMailboxTags(accountId: string): Promise<MailboxTag[]> {
  const { data, error } = await supabase
    .from('mailbox_tags')
    .select('*')
    .eq('account_id', accountId)
    .order('name');

  if (error) {
    throw new Error(`Failed to fetch mailbox tags: ${error.message}`);
  }

  return data ?? [];
}

export async function createMailboxTag(
  accountId: string,
  params: { name: string; color?: string | null },
): Promise<MailboxTag> {
  const { data, error } = await supabase
    .from('mailbox_tags')
    .insert({
      account_id: accountId,
      name: params.name.trim(),
      color: params.color ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(getTagCreateErrorMessage(error, params.name));
  }

  return data;
}

export async function updateMailboxTag(
  tagId: string,
  params: { color?: string | null; name?: string },
): Promise<MailboxTag> {
  const updates: { color?: string | null; name?: string } = {};
  if (params.color !== undefined) updates.color = params.color;
  if (params.name !== undefined) updates.name = params.name.trim();
  if (Object.keys(updates).length === 0) {
    const { data } = await supabase.from('mailbox_tags').select('*').eq('id', tagId).single();
    if (!data) throw new Error('Tag not found');
    return data;
  }

  const { data, error } = await supabase
    .from('mailbox_tags')
    .update(updates)
    .eq('id', tagId)
    .select()
    .single();

  if (error) {
    throw new Error(getTagUpdateErrorMessage(error, params.name));
  }

  return data;
}

export async function deleteMailboxTag(tagId: string): Promise<void> {
  const { error } = await supabase.from('mailbox_tags').delete().eq('id', tagId);
  if (error) {
    throw new Error(`Failed to delete mailbox tag: ${error.message}`);
  }
}

async function getMailboxAccountId(mailboxId: string): Promise<string> {
  const { data: mailbox } = await supabase
    .from('mailboxes')
    .select('account_id')
    .eq('id', mailboxId)
    .is('deleted_at', null)
    .single();
  const accountId = mailbox?.account_id;
  if (!accountId) throw new Error('Mailbox not found or missing account_id');
  return accountId;
}

export async function addTagToMailbox(mailboxId: string, tagId: string): Promise<void> {
  const accountId = await getMailboxAccountId(mailboxId);

  const { error } = await supabase.from('mailbox_tag_assignments').insert({
    mailbox_id: mailboxId,
    tag_id: tagId,
    account_id: accountId,
  });

  if (error) {
    throw new Error(`Failed to add tag to mailbox: ${error.message}`);
  }
}

export async function removeTagFromMailbox(mailboxId: string, tagId: string): Promise<void> {
  const { error } = await supabase
    .from('mailbox_tag_assignments')
    .delete()
    .eq('mailbox_id', mailboxId)
    .eq('tag_id', tagId);

  if (error) {
    throw new Error(`Failed to remove tag from mailbox: ${error.message}`);
  }
}

export async function setMailboxTags(mailboxId: string, tagIds: string[]): Promise<void> {
  const accountId = await getMailboxAccountId(mailboxId);
  const uniqueTagIds = [...new Set(tagIds)];

  const { error: deleteError } = await supabase
    .from('mailbox_tag_assignments')
    .delete()
    .eq('mailbox_id', mailboxId);
  if (deleteError) {
    throw new Error(`Failed to clear mailbox tags: ${deleteError.message}`);
  }

  if (uniqueTagIds.length === 0) return;

  const { error: insertError } = await supabase.from('mailbox_tag_assignments').insert(
    uniqueTagIds.map((tagId) => ({
      mailbox_id: mailboxId,
      tag_id: tagId,
      account_id: accountId,
    })),
  );
  if (insertError) {
    throw new Error(`Failed to set mailbox tags: ${insertError.message}`);
  }
}

export async function addTagsToMailbox(mailboxId: string, tagIds: string[]): Promise<void> {
  const accountId = await getMailboxAccountId(mailboxId);
  const uniqueTagIds = [...new Set(tagIds.filter(Boolean))];
  if (uniqueTagIds.length === 0) return;

  const { data: existing } = await supabase
    .from('mailbox_tag_assignments')
    .select('tag_id')
    .eq('mailbox_id', mailboxId)
    .in('tag_id', uniqueTagIds);

  const existingSet = new Set((existing ?? []).map((row) => row.tag_id));
  const toInsert = uniqueTagIds.filter((id) => !existingSet.has(id));
  if (toInsert.length === 0) return;

  const { error } = await supabase.from('mailbox_tag_assignments').insert(
    toInsert.map((tagId) => ({
      mailbox_id: mailboxId,
      tag_id: tagId,
      account_id: accountId,
    })),
  );
  if (error) {
    throw new Error(`Failed to add mailbox tags: ${error.message}`);
  }
}

export async function removeTagsFromMailbox(mailboxId: string, tagIds: string[]): Promise<void> {
  const uniqueTagIds = [...new Set(tagIds.filter(Boolean))];
  if (uniqueTagIds.length === 0) return;

  const { error } = await supabase
    .from('mailbox_tag_assignments')
    .delete()
    .eq('mailbox_id', mailboxId)
    .in('tag_id', uniqueTagIds);

  if (error) {
    throw new Error(`Failed to remove mailbox tags: ${error.message}`);
  }
}

export async function getTagsForMailbox(mailboxId: string): Promise<MailboxTag[]> {
  const { data: assignments, error: assignError } = await supabase
    .from('mailbox_tag_assignments')
    .select('tag_id')
    .eq('mailbox_id', mailboxId);

  if (assignError) {
    throw new Error(`Failed to fetch mailbox tag assignments: ${assignError.message}`);
  }

  const tagIds = (assignments ?? []).map((assignment) => assignment.tag_id);
  if (tagIds.length === 0) return [];

  const { data: tags, error: tagsError } = await supabase
    .from('mailbox_tags')
    .select('*')
    .in('id', tagIds)
    .order('name');

  if (tagsError) {
    throw new Error(`Failed to fetch mailbox tags: ${tagsError.message}`);
  }

  return dataOrEmpty(tags);
}

export async function getTagsForMailboxes(
  mailboxIds: string[],
): Promise<Record<string, MailboxTag[]>> {
  if (mailboxIds.length === 0) return {};

  const { data: assignments, error: assignError } = await supabase
    .from('mailbox_tag_assignments')
    .select('mailbox_id, tag_id')
    .in('mailbox_id', mailboxIds);

  if (assignError) {
    throw new Error(`Failed to fetch mailbox tag assignments: ${assignError.message}`);
  }

  const tagIds = [...new Set((assignments ?? []).map((assignment) => assignment.tag_id))];
  const result: Record<string, MailboxTag[]> = {};
  for (const mailboxId of mailboxIds) {
    result[mailboxId] = [];
  }

  if (tagIds.length === 0) return result;

  const { data: tags, error: tagsError } = await supabase
    .from('mailbox_tags')
    .select('*')
    .in('id', tagIds);

  if (tagsError) {
    throw new Error(`Failed to fetch mailbox tags: ${tagsError.message}`);
  }

  const tagMap = new Map<string, MailboxTag>((tags ?? []).map((tag) => [tag.id, tag]));
  for (const assignment of assignments ?? []) {
    const tag = tagMap.get(assignment.tag_id);
    if (tag && result[assignment.mailbox_id]) {
      result[assignment.mailbox_id].push(tag);
    }
  }

  for (const mailboxId of mailboxIds) {
    result[mailboxId].sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

export async function getMailboxIdsForTags(
  accountId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];

  const { data, error } = await supabase
    .from('mailbox_tag_assignments')
    .select('mailbox_id')
    .eq('account_id', accountId)
    .in('tag_id', tagIds);

  if (error) {
    throw new Error(`Failed to fetch mailboxes for tags: ${error.message}`);
  }

  return [...new Set((data ?? []).map((row) => row.mailbox_id))];
}

export async function validateMailboxTagIds(
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

  if (error) {
    throw new Error(`Failed to validate mailbox tags: ${error.message}`);
  }

  if ((data ?? []).length !== unique.length) {
    throw new Error('One or more tag ids are invalid for this account');
  }
}

export interface BulkMailboxTagPatchInput {
  mode: 'patch' | 'replace';
  addTagIds: string[];
  removeTagIds: string[];
  replaceTagIds: string[];
}

export async function applyBulkMailboxTagChanges(
  mailboxIds: string[],
  changes: BulkMailboxTagPatchInput,
): Promise<void> {
  if (mailboxIds.length === 0) return;

  if (changes.mode === 'replace') {
    await Promise.all(mailboxIds.map((mailboxId) => setMailboxTags(mailboxId, changes.replaceTagIds)));
    return;
  }

  const addSet = new Set(changes.addTagIds);
  const addTagIds = changes.addTagIds;
  const removeTagIds = changes.removeTagIds.filter((id) => !addSet.has(id));
  if (addTagIds.length === 0 && removeTagIds.length === 0) return;

  await Promise.all(
    mailboxIds.map(async (mailboxId) => {
      if (addTagIds.length > 0) await addTagsToMailbox(mailboxId, addTagIds);
      if (removeTagIds.length > 0) await removeTagsFromMailbox(mailboxId, removeTagIds);
    }),
  );
}

function dataOrEmpty<T>(data: T[] | null): T[] {
  return data ?? [];
}
