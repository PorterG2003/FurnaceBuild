import { supabase } from '../client';

export interface ThreadTag {
  id: string;
  account_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface ThreadTagAssignment {
  thread_id: string;
  tag_id: string;
  created_at: string;
}

/**
 * List tags for an account.
 */
export async function getThreadTags(accountId: string): Promise<ThreadTag[]> {
  const { data, error } = await supabase
    .from('thread_tags')
    .select('*')
    .eq('account_id', accountId)
    .order('name');

  if (error) {
    throw new Error(`Failed to fetch thread tags: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Create a tag for an account.
 */
export async function createThreadTag(
  accountId: string,
  params: { name: string; color?: string | null }
): Promise<ThreadTag> {
  const { data, error } = await supabase
    .from('thread_tags')
    .insert({
      account_id: accountId,
      name: params.name.trim(),
      color: params.color ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create thread tag: ${error.message}`);
  }

  return data;
}

/**
 * Update a tag's color or name.
 */
export async function updateThreadTag(
  tagId: string,
  params: { color?: string | null; name?: string }
): Promise<ThreadTag> {
  const updates: { color?: string | null; name?: string } = {};
  if (params.color !== undefined) updates.color = params.color;
  if (params.name !== undefined) updates.name = params.name.trim();
  if (Object.keys(updates).length === 0) {
    const { data } = await supabase.from('thread_tags').select('*').eq('id', tagId).single();
    if (!data) throw new Error('Tag not found');
    return data;
  }
  const { data, error } = await supabase
    .from('thread_tags')
    .update(updates)
    .eq('id', tagId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update thread tag: ${error.message}`);
  }

  return data;
}

/**
 * Add a tag to a thread.
 */
export async function addTagToThread(threadId: string, tagId: string): Promise<void> {
  const { data: thread } = await supabase.from('email_threads').select('account_id').eq('id', threadId).single();
  const accountId = thread?.account_id;
  if (!accountId) throw new Error('Thread not found or missing account_id');

  const { error } = await supabase.from('thread_tag_assignments').insert({
    thread_id: threadId,
    tag_id: tagId,
    account_id: accountId,
  });

  if (error) {
    throw new Error(`Failed to add tag to thread: ${error.message}`);
  }
}

/**
 * Remove a tag from a thread.
 */
export async function removeTagFromThread(threadId: string, tagId: string): Promise<void> {
  const { error } = await supabase
    .from('thread_tag_assignments')
    .delete()
    .eq('thread_id', threadId)
    .eq('tag_id', tagId);

  if (error) {
    throw new Error(`Failed to remove tag from thread: ${error.message}`);
  }
}

/**
 * Permanently delete a tag from the account.
 * Removes all thread assignments via CASCADE.
 */
export async function deleteThreadTag(tagId: string): Promise<void> {
  const { error } = await supabase.from('thread_tags').delete().eq('id', tagId);
  if (error) {
    throw new Error(`Failed to delete tag: ${error.message}`);
  }
}

/**
 * Get tags for multiple threads in one call.
 * Returns a map of thread_id -> ThreadTag[].
 */
export async function getTagsForThreads(threadIds: string[]): Promise<Record<string, ThreadTag[]>> {
  if (threadIds.length === 0) return {};

  const { data: assignments, error: assignError } = await supabase
    .from('thread_tag_assignments')
    .select('thread_id, tag_id')
    .in('thread_id', threadIds);

  if (assignError) {
    throw new Error(`Failed to fetch thread tag assignments: ${assignError.message}`);
  }

  const tagIds = [...new Set((assignments ?? []).map((a) => a.tag_id))];
  if (tagIds.length === 0) {
    return Object.fromEntries(threadIds.map((id) => [id, []]));
  }

  const { data: tags, error: tagsError } = await supabase
    .from('thread_tags')
    .select('*')
    .in('id', tagIds);

  if (tagsError) {
    throw new Error(`Failed to fetch thread tags: ${tagsError.message}`);
  }

  const tagMap = new Map<string, ThreadTag>((tags ?? []).map((t) => [t.id, t]));
  const result: Record<string, ThreadTag[]> = {};
  for (const id of threadIds) {
    result[id] = [];
  }
  for (const a of assignments ?? []) {
    const tag = tagMap.get(a.tag_id);
    if (tag && result[a.thread_id]) {
      result[a.thread_id].push(tag);
    }
  }
  return result;
}

/**
 * Get tags assigned to a thread.
 */
export async function getTagsForThread(threadId: string): Promise<ThreadTag[]> {
  const { data: assignments, error: assignError } = await supabase
    .from('thread_tag_assignments')
    .select('tag_id')
    .eq('thread_id', threadId);

  if (assignError) {
    throw new Error(`Failed to fetch thread tag assignments: ${assignError.message}`);
  }

  const tagIds = (assignments ?? []).map((a) => a.tag_id);
  if (tagIds.length === 0) {
    return [];
  }

  const { data: tags, error: tagsError } = await supabase
    .from('thread_tags')
    .select('*')
    .in('id', tagIds);

  if (tagsError) {
    throw new Error(`Failed to fetch thread tags: ${tagsError.message}`);
  }

  return tags ?? [];
}
