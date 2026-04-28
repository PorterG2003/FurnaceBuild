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
import { getFluxCampaigns, createFluxCampaign, deleteFluxCampaign } from '@/lib/supabase/services/flux';
import type { FluxCampaignRow } from '@/lib/flux/types';
import { formatFluxListDate } from '@/lib/flux/formatFluxListDate';

export default function FluxCampaignsList() {
  const { account } = useAccount();
  const router = useRouter();
  const { toast } = useToast();
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;

  const [campaigns, setCampaigns] = useState<FluxCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FluxCampaignRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const showLoader = useSmoothLoading(loading);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError('');
    try {
      setCampaigns(await getFluxCampaigns(account.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
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

  const confirmDeleteCampaign = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteFluxCampaign(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('Campaign deleted.');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete campaign');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, load, toast]);

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

  return (
    <>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <PageHeader
          title="Campaigns"
          subtitle="Templates and AI chat for each Flux campaign"
          primaryAction={isMobile ? newCampaignButtonMobile : newCampaignButtonDesktop}
        />

        {error ? (
          <Alert variant="error" message={error} actionText="Try again" onAction={() => void load()} />
        ) : null}

        {loading || showLoader ? <LoadingState message={loading ? 'Loading…' : undefined} /> : null}

        {!error && !loading && !showLoader && campaigns.length === 0 ? (
          <EmptyState
            className="py-10"
            title="No campaigns yet"
            description="Create a campaign to build your page template and add prospects."
            action={
              <Pressable
                onPress={() => setCreateModalOpen(true)}
                className={`rounded-xl px-6 py-3 flex-row items-center justify-center gap-2 bg-[#f85102] ${isMobile ? 'w-full' : ''}`}
              >
                <PlusIcon size={20} color="#ffffff" />
                <Text className="text-white font-instrument-medium text-base">Create campaign</Text>
              </Pressable>
            }
          />
        ) : null}

        {!error && !loading && !showLoader && campaigns.length > 0 ? (
          <View className="gap-3">
            {campaigns.map((c) => (
              <Card key={c.id} className="mb-0">
                <View className="flex-row items-start gap-2">
                  <Pressable
                    className="flex-1 min-w-0"
                    onPress={() => router.push(`/flux/campaigns/${c.id}` as Href)}
                  >
                    <Text className="text-white text-base font-instrument-semibold mb-1">{c.name}</Text>
                    {c.offer_description ? (
                      <Text className="text-gray-400 text-sm font-instrument mb-1" numberOfLines={2}>
                        {c.offer_description}
                      </Text>
                    ) : null}
                    <Text className="text-gray-500 text-xs font-instrument">
                      Updated {formatFluxListDate(c.updated_at)}
                    </Text>
                  </Pressable>
                  <FluxRowOverflowMenu
                    sheetTitle={c.name}
                    onEdit={() => router.push(`/flux/campaigns/${c.id}` as Href)}
                    onDelete={() => setDeleteTarget(c)}
                    disabled={deleting}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <CreateFluxCampaignModal
        visible={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateCampaign}
        isLoading={creating}
      />

      <ConfirmDeleteModal
        visible={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="Delete campaign?"
        itemName={deleteTarget?.name.trim() || 'Campaign'}
        description="This removes the campaign, its template, prospects, and pages."
        isLoading={deleting}
        requireConfirmation={false}
        onConfirm={confirmDeleteCampaign}
      />
    </>
  );
}
