import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { FluxRowOverflowMenu } from '@/components/flux';
import {
  getFluxProspectsByAccount,
  getFluxCampaigns,
  deleteFluxProspect,
} from '@/lib/supabase/services/flux';
import type { FluxProspectRow, FluxCampaignRow } from '@/lib/flux/types';
import { formatFluxListDate } from '@/lib/flux/formatFluxListDate';

export default function FluxProspectsList() {
  const { account } = useAccount();
  const router = useRouter();
  const { toast } = useToast();
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;

  const [prospects, setProspects] = useState<FluxProspectRow[]>([]);
  const [campaigns, setCampaigns] = useState<FluxCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FluxProspectRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const showLoader = useSmoothLoading(loading);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError('');
    try {
      const [p, c] = await Promise.all([
        getFluxProspectsByAccount(account.id),
        getFluxCampaigns(account.id),
      ]);
      setProspects(p);
      setCampaigns(c);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load prospects');
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  const campaignNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c.id, c.name);
    return m;
  }, [campaigns]);

  const confirmDeleteProspect = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteFluxProspect(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('Prospect deleted.');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete prospect');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, load, toast]);

  const newProspectDesktop = (
    <Pressable
      onPress={() => router.push('/flux/prospects/new' as Href)}
      className="rounded-xl px-6 py-3 flex-row items-center justify-center gap-2 bg-[#f85102]"
    >
      <PlusIcon size={20} color="#ffffff" />
      <Text className="text-white font-instrument-medium text-base">New prospect</Text>
    </Pressable>
  );

  const newProspectMobile = (
    <MobileHeaderButton
      variant="add"
      onPress={() => router.push('/flux/prospects/new' as Href)}
      accessibilityLabel="New prospect"
    />
  );

  return (
    <>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <PageHeader
          title="Prospects"
          subtitle="One personalized page per contact, tied to a campaign"
          primaryAction={isMobile ? newProspectMobile : newProspectDesktop}
        />

        {error ? (
          <Alert variant="error" message={error} actionText="Try again" onAction={() => void load()} />
        ) : null}

        {loading || showLoader ? <LoadingState message={loading ? 'Loading…' : undefined} /> : null}

        {!error && !loading && !showLoader && campaigns.length === 0 ? (
          <View className="border border-[#2A2A2A] rounded-xl p-4 mb-4 bg-[#1A1A1A]/50">
            <Text className="text-gray-400 text-sm font-instrument text-center">
              Create a Flux campaign first, then add prospects from a campaign or here.
            </Text>
          </View>
        ) : null}

        {!error && !loading && !showLoader && prospects.length === 0 ? (
          <EmptyState
            className="py-10"
            title="No prospects yet"
            description="Add a prospect to generate their page and URL."
            action={
              <Pressable
                onPress={() => router.push('/flux/prospects/new' as Href)}
                className={`rounded-xl px-6 py-3 flex-row items-center justify-center gap-2 bg-[#f85102] ${isMobile ? 'w-full' : ''}`}
              >
                <PlusIcon size={20} color="#ffffff" />
                <Text className="text-white font-instrument-medium text-base">New prospect</Text>
              </Pressable>
            }
          />
        ) : null}

        {!error && !loading && !showLoader && prospects.length > 0 ? (
          <View className="gap-3">
            {prospects.map((p) => (
              <Card key={p.id} className="mb-0">
                <View className="flex-row items-start gap-2">
                  <Pressable
                    className="flex-1 min-w-0"
                    onPress={() => router.push(`/flux/prospects/${p.id}` as Href)}
                  >
                    <Text className="text-white text-base font-instrument-semibold mb-0.5">{p.name}</Text>
                    <Text className="text-gray-400 text-sm font-instrument mb-1">{p.company}</Text>
                    <Text className="text-gray-500 text-xs font-instrument">
                      {campaignNameById.get(p.campaign_id) ?? 'Campaign'} ·{' '}
                      {formatFluxListDate(p.created_at)}
                    </Text>
                  </Pressable>
                  <FluxRowOverflowMenu
                    sheetTitle={p.name}
                    onEdit={() => router.push(`/flux/prospects/${p.id}` as Href)}
                    onDelete={() => setDeleteTarget(p)}
                    disabled={deleting}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ConfirmDeleteModal
        visible={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="Delete prospect?"
        itemName={deleteTarget?.name.trim() || 'Prospect'}
        description="Removes the contact and their page. This cannot be undone."
        isLoading={deleting}
        requireConfirmation={false}
        onConfirm={confirmDeleteProspect}
      />
    </>
  );
}
