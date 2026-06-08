import { useCallback, useEffect, useState } from 'react';
import {
  type BulkMailboxTagChanges,
  normalizeBulkMailboxPatchTags,
} from '@/components/senders/types';
import {
  addTagToMailbox,
  applyBulkMailboxTagChanges,
  createMailboxTag,
  deleteMailboxTag,
  getMailboxTags,
  getTagsForMailbox,
  getTagsForMailboxes,
  removeTagFromMailbox,
  updateMailboxTag,
  type MailboxTag,
} from '@/lib/supabase/services/mailbox-tags';
import type { TagLike } from '@/lib/tags/types';

export function useMailboxTags(accountId: string | null, mailboxIds?: string[]) {
  const [accountMailboxTags, setAccountMailboxTags] = useState<MailboxTag[]>([]);
  const [mailboxTagsMap, setMailboxTagsMap] = useState<Record<string, MailboxTag[]>>({});
  const [loading, setLoading] = useState(false);

  const loadAccountTags = useCallback(async () => {
    if (!accountId) {
      setAccountMailboxTags([]);
      return;
    }
    const tags = await getMailboxTags(accountId);
    setAccountMailboxTags(tags);
  }, [accountId]);

  const loadMailboxTagsMap = useCallback(async () => {
    if (!mailboxIds?.length) {
      setMailboxTagsMap({});
      return;
    }
    const map = await getTagsForMailboxes(mailboxIds);
    setMailboxTagsMap(map);
  }, [mailboxIds]);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      await Promise.all([loadAccountTags(), loadMailboxTagsMap()]);
    } finally {
      setLoading(false);
    }
  }, [accountId, loadAccountTags, loadMailboxTagsMap]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleTagCreated = useCallback((tag: MailboxTag) => {
    setAccountMailboxTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  const handleAddTagToMailbox = useCallback(
    async (mailboxId: string, tag: TagLike) => {
      await addTagToMailbox(mailboxId, tag.id);
      setMailboxTagsMap((prev) => {
        const existing = prev[mailboxId] ?? [];
        if (existing.some((entry) => entry.id === tag.id)) return prev;
        const fullTag = accountMailboxTags.find((entry) => entry.id === tag.id) ?? (tag as MailboxTag);
        return {
          ...prev,
          [mailboxId]: [...existing, fullTag].sort((a, b) => a.name.localeCompare(b.name)),
        };
      });
    },
    [accountMailboxTags],
  );

  const handleRemoveTagFromMailbox = useCallback(async (mailboxId: string, tag: TagLike) => {
    await removeTagFromMailbox(mailboxId, tag.id);
    setMailboxTagsMap((prev) => ({
      ...prev,
      [mailboxId]: (prev[mailboxId] ?? []).filter((entry) => entry.id !== tag.id),
    }));
  }, []);

  const handleUpdateTag = useCallback((updated: TagLike) => {
    const full = updated as MailboxTag;
    setAccountMailboxTags((prev) =>
      prev.map((tag) => (tag.id === full.id ? full : tag)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    setMailboxTagsMap((prev) => {
      const next: Record<string, MailboxTag[]> = {};
      for (const [mailboxId, tags] of Object.entries(prev)) {
        next[mailboxId] = tags.map((tag) => (tag.id === full.id ? full : tag));
      }
      return next;
    });
  }, []);

  const handleDeleteTag = useCallback((deleted: TagLike) => {
    setAccountMailboxTags((prev) => prev.filter((tag) => tag.id !== deleted.id));
    setMailboxTagsMap((prev) => {
      const next: Record<string, MailboxTag[]> = {};
      for (const [mailboxId, tags] of Object.entries(prev)) {
        next[mailboxId] = tags.filter((tag) => tag.id !== deleted.id);
      }
      return next;
    });
  }, []);

  const loadTagsForSingleMailbox = useCallback(async (mailboxId: string) => {
    const tags = await getTagsForMailbox(mailboxId);
    setMailboxTagsMap((prev) => ({ ...prev, [mailboxId]: tags }));
    return tags;
  }, []);

  const applyBulkTagChanges = useCallback(
    async (mailboxIds: string[], changes: BulkMailboxTagChanges) => {
      const normalizedChanges: BulkMailboxTagChanges =
        changes.mode === 'replace'
          ? changes
          : { ...changes, ...normalizeBulkMailboxPatchTags(changes) };

      await applyBulkMailboxTagChanges(mailboxIds, normalizedChanges);
      setMailboxTagsMap((prev) => {
        const next = { ...prev };
        const tagById = new Map(accountMailboxTags.map((tag) => [tag.id, tag]));

        for (const mailboxId of mailboxIds) {
          const existing = next[mailboxId] ?? [];

          if (normalizedChanges.mode === 'replace') {
            next[mailboxId] = normalizedChanges.replaceTagIds
              .map((tagId) => tagById.get(tagId))
              .filter((tag): tag is MailboxTag => tag != null)
              .sort((a, b) => a.name.localeCompare(b.name));
            continue;
          }

          let updated = [...existing];
          if (normalizedChanges.removeTagIds.length > 0) {
            const removeSet = new Set(normalizedChanges.removeTagIds);
            updated = updated.filter((tag) => !removeSet.has(tag.id));
          }
          if (normalizedChanges.addTagIds.length > 0) {
            const existingIds = new Set(updated.map((tag) => tag.id));
            for (const tagId of normalizedChanges.addTagIds) {
              if (existingIds.has(tagId)) continue;
              const tag = tagById.get(tagId);
              if (tag) {
                updated.push(tag);
                existingIds.add(tagId);
              }
            }
          }
          next[mailboxId] = updated.sort((a, b) => a.name.localeCompare(b.name));
        }

        return next;
      });
    },
    [accountMailboxTags],
  );

  return {
    accountMailboxTags,
    mailboxTagsMap,
    loading,
    refresh,
    loadTagsForSingleMailbox,
    handleTagCreated,
    handleAddTagToMailbox,
    handleRemoveTagFromMailbox,
    handleUpdateTag,
    handleDeleteTag,
    applyBulkTagChanges,
    createMailboxTag,
    updateMailboxTag,
    deleteMailboxTag,
  };
}
