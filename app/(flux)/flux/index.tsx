import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { PlusIcon } from 'react-native-heroicons/outline';
import { useAccount } from '@/contexts/AccountContext';
import { Card } from '@/components/ui/Card';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import {
  Alert,
  EmptyState,
  LoadingState,
  useSmoothLoading,
  useToast,
} from '@/components/ui/feedback';
import { ConfirmDeleteModal } from '@/components/ui/modals';
import { CreateFluxCampaignModal, FluxRowOverflowMenu } from '@/components/flux';
import {
  getFluxCampaigns,
  createFluxCampaign,
  getRecentFluxPages,
  deleteFluxCampaign,
  deleteFluxProspect,
} from '@/lib/supabase/services/flux';
import type { FluxCampaignRow, FluxProspectPageRow } from '@/lib/flux/types';
import { hasRenderableFluxPageConfig } from '@/lib/flux/coercePageConfig';
import { formatFluxListDate } from '@/lib/flux/formatFluxListDate';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-300',
  live: 'bg-green-500/20 text-green-300',
  archived: 'bg-gray-500/20 text-gray-400',
};

type PendingDelete =
  | { kind: 'campaign'; row: FluxCampaignRow }
  | { kind: 'prospect_page'; row: FluxProspectPageRow };

export default function FluxDashboard() {
  const { account } = useAccount();
  const router = useRouter();
  const { toast } = useToast();
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;

  const [campaigns, setCampaigns] = useState<FluxCampaignRow[]>([]);
  const [recentPages, setRecentPages] = useState<FluxProspectPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const showLoader = useSmoothLoading(loading);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError('');
    try {
      const [c, p] = await Promise.all([
        getFluxCampaigns(account.id),
        getRecentFluxPages(account.id, 10),
      ]);
      setCampaigns(c);
      setRecentPages(p);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Flux data');
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateCampaign = async (name: string) => {
    if (!account) throw new Error('No account selected');
    if (creating) return;
    setCreating(true);
    try {
      const campaign = await createFluxCampaign(account.id, name);
      router.push(`/flux/campaigns/${campaign.id}` as Href);
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'campaign') {
        await deleteFluxCampaign(pendingDelete.row.id);
        toast.success('Campaign deleted.');
      } else {
        await deleteFluxProspect(pendingDelete.row.prospect_id);
        toast.success('Prospect deleted.');
      }
      setPendingDelete(null);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, deleting, load, toast]);

  const newCampaignButtonDesktop = (
    <Pressable
      onPress={() => setCreateModalOpen(true)}
      className="rounded-xl px-6 py-3 flex-row items-center justify-center gap-2 bg-[#f85102]"
    >
      <PlusIcon size={20} color="#ffffff" />
      <Text className="text-white font-instrument-medium text-base">New campaign</Text>
    </Pressable>
  );

  const newCampaignButtonMobile = (
    <MobileHeaderButton
      variant="add"
      onPress={() => setCreateModalOpen(true)}
      accessibilityLabel="New campaign"
    />
  );

  const deleteModalTitle =
    pendingDelete?.kind === 'campaign' ? 'Delete campaign?' : 'Delete prospect?';
  const deleteModalItemName =
    pendingDelete?.kind === 'campaign'
      ? pendingDelete.row.name.trim() || 'Campaign'
      : `/p/${pendingDelete?.row.slug ?? ''}`;
  const deleteModalDescription =
    pendingDelete?.kind === 'campaign'
      ? 'This removes the campaign, its template, prospects, and pages.'
      : 'Removes the contact and their page. This cannot be undone.';

  return (
    <>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 60 }}>
        <PageHeader
          title="Flux"
          subtitle="Personalized prospect pages tied to your campaigns"
          primaryAction={isMobile ? newCampaignButtonMobile : newCampaignButtonDesktop}
        />

        {error ? (
          <Alert variant="error" message={error} actionText="Try again" onAction={() => void load()} />
        ) : null}

        {loading || showLoader ? (
          <LoadingState message={loading ? 'Loading…' : undefined} />
        ) : null}

        {!error && !loading && !showLoader ? (
          <>
            <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">
              Campaigns
            </Text>
            {campaigns.length === 0 ? (
              <EmptyState
                className="py-10 mb-6"
                title="No campaigns yet"
                description="Create a campaign to define your page template, then add prospects."
                action={
                  <Pressable
                    onPress={() => setCreateModalOpen(true)}
                    className="rounded-xl px-6 py-3 flex-row items-center justify-center gap-2 bg-[#f85102] w-full"
                  >
                    <PlusIcon size={20} color="#ffffff" />
                    <Text className="text-white font-instrument-medium text-base">Create campaign</Text>
                  </Pressable>
                }
              />
            ) : (
              <View className="gap-3 mb-8">
                {campaigns.map((c) => (
                  <Card key={c.id} className="mb-0">
                    <View className="flex-row items-start gap-2">
                      <Pressable
                        className="flex-1 min-w-0"
                        onPress={() => router.push(`/flux/campaigns/${c.id}` as Href)}
                      >
                        <Text className="text-white text-base font-instrument-semibold mb-1">{c.name}</Text>
                        {c.offer_description ? (
                          <Text className="text-gray-400 text-sm font-instrument" numberOfLines={2}>
                            {c.offer_description}
                          </Text>
                        ) : null}
                        <Text className="text-gray-500 text-xs font-instrument mt-1">
                          {formatFluxListDate(c.created_at)}
                        </Text>
                      </Pressable>
                      <FluxRowOverflowMenu
                        sheetTitle={c.name}
                        onEdit={() => router.push(`/flux/campaigns/${c.id}` as Href)}
                        onDelete={() => setPendingDelete({ kind: 'campaign', row: c })}
                        disabled={deleting}
                      />
                    </View>
                  </Card>
                ))}
              </View>
            )}

            <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">
              Recent pages
            </Text>
            {recentPages.length === 0 ? (
              <EmptyState
                className="py-10"
                title="No prospect pages yet"
                description="Pages appear here after you create prospects and generate their URLs."
              />
            ) : (
              <View className="gap-2">
                {recentPages.map((p) => (
                  <Card key={p.id} className="mb-0">
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        className="flex-1 min-w-0"
                        onPress={() => router.push(`/flux/prospects/${p.prospect_id}` as Href)}
                      >
                        <Text className="text-white text-sm font-instrument-semibold">/p/{p.slug}</Text>
                        <Text className="text-gray-500 text-xs font-instrument mt-1">
                          Updated {formatFluxListDate(p.updated_at)}
                        </Text>
                        <View className="flex-row flex-wrap items-center gap-1 mt-2">
                          <View className={`px-2 py-0.5 rounded-md ${STATUS_COLORS[p.status] || ''}`}>
                            <Text className="text-xs font-instrument-semibold">{p.status}</Text>
                          </View>
                          {p.status === 'live' && !hasRenderableFluxPageConfig(p.page_config) ? (
                            <View className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30">
                              <Text className="text-xs font-instrument-semibold text-amber-200">no content</Text>
                            </View>
                          ) : null}
                          <Text className="text-gray-500 text-xs font-instrument">{p.view_count} views</Text>
                        </View>
                      </Pressable>
                      <FluxRowOverflowMenu
                        sheetTitle={`/p/${p.slug}`}
                        onEdit={() => router.push(`/flux/prospects/${p.prospect_id}` as Href)}
                        onDelete={() => setPendingDelete({ kind: 'prospect_page', row: p })}
                        disabled={deleting}
                      />
                    </View>
                  </Card>
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>

      <CreateFluxCampaignModal
        visible={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateCampaign}
        isLoading={creating}
      />

      <ConfirmDeleteModal
        visible={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        title={deleteModalTitle}
        itemName={deleteModalItemName}
        description={deleteModalDescription}
        isLoading={deleting}
        requireConfirmation={false}
        onConfirm={confirmDelete}
      />
    </>
  );
}
