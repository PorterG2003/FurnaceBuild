import { useCallback, useEffect, useState } from 'react';
import {
  addTagToCampaign,
  createCampaignTag,
  deleteCampaignTag,
  getCampaignTags,
  getTagsForCampaign,
  getTagsForCampaigns,
  removeTagFromCampaign,
  updateCampaignTag,
  type CampaignTag,
} from '@/lib/supabase/services/campaign-tags';
import type { TagLike } from '@/lib/tags/types';

export function useCampaignTags(accountId: string | null, campaignIds?: string[]) {
  const [accountCampaignTags, setAccountCampaignTags] = useState<CampaignTag[]>([]);
  const [campaignTagsMap, setCampaignTagsMap] = useState<Record<string, CampaignTag[]>>({});
  const [loading, setLoading] = useState(false);

  const loadAccountTags = useCallback(async () => {
    if (!accountId) {
      setAccountCampaignTags([]);
      return;
    }
    const tags = await getCampaignTags(accountId);
    setAccountCampaignTags(tags);
  }, [accountId]);

  const loadCampaignTagsMap = useCallback(async () => {
    if (!campaignIds?.length) {
      setCampaignTagsMap({});
      return;
    }
    const map = await getTagsForCampaigns(campaignIds);
    setCampaignTagsMap(map);
  }, [campaignIds]);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      await Promise.all([loadAccountTags(), loadCampaignTagsMap()]);
    } finally {
      setLoading(false);
    }
  }, [accountId, loadAccountTags, loadCampaignTagsMap]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleTagCreated = useCallback((tag: CampaignTag) => {
    setAccountCampaignTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  const handleAddTagToCampaign = useCallback(
    async (campaignId: string, tag: TagLike) => {
      await addTagToCampaign(campaignId, tag.id);
      setCampaignTagsMap((prev) => {
        const existing = prev[campaignId] ?? [];
        if (existing.some((t) => t.id === tag.id)) return prev;
        const fullTag = accountCampaignTags.find((t) => t.id === tag.id) ?? (tag as CampaignTag);
        return {
          ...prev,
          [campaignId]: [...existing, fullTag].sort((a, b) => a.name.localeCompare(b.name)),
        };
      });
    },
    [accountCampaignTags],
  );

  const handleRemoveTagFromCampaign = useCallback(async (campaignId: string, tag: TagLike) => {
    await removeTagFromCampaign(campaignId, tag.id);
    setCampaignTagsMap((prev) => ({
      ...prev,
      [campaignId]: (prev[campaignId] ?? []).filter((t) => t.id !== tag.id),
    }));
  }, []);

  const handleUpdateTag = useCallback((updated: TagLike) => {
    const full = updated as CampaignTag;
    setAccountCampaignTags((prev) =>
      prev.map((t) => (t.id === full.id ? full : t)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    setCampaignTagsMap((prev) => {
      const next: Record<string, CampaignTag[]> = {};
      for (const [campaignId, tags] of Object.entries(prev)) {
        next[campaignId] = tags.map((t) => (t.id === full.id ? full : t));
      }
      return next;
    });
  }, []);

  const handleDeleteTag = useCallback((deleted: TagLike) => {
    setAccountCampaignTags((prev) => prev.filter((t) => t.id !== deleted.id));
    setCampaignTagsMap((prev) => {
      const next: Record<string, CampaignTag[]> = {};
      for (const [campaignId, tags] of Object.entries(prev)) {
        next[campaignId] = tags.filter((t) => t.id !== deleted.id);
      }
      return next;
    });
  }, []);

  const loadTagsForSingleCampaign = useCallback(async (campaignId: string) => {
    const tags = await getTagsForCampaign(campaignId);
    setCampaignTagsMap((prev) => ({ ...prev, [campaignId]: tags }));
    return tags;
  }, []);

  return {
    accountCampaignTags,
    campaignTagsMap,
    loading,
    refresh,
    loadTagsForSingleCampaign,
    handleTagCreated,
    handleAddTagToCampaign,
    handleRemoveTagFromCampaign,
    handleUpdateTag,
    handleDeleteTag,
    createCampaignTag: createCampaignTag,
    updateCampaignTag: updateCampaignTag,
    deleteCampaignTag: deleteCampaignTag,
  };
}
