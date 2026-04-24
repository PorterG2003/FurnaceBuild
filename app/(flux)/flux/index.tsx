import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { Button } from '@/components/ui/button';
import {
  getFluxCampaigns,
  createFluxCampaign,
  getRecentFluxPages,
} from '@/lib/supabase/services/flux';
import type { FluxCampaignRow, FluxProspectPageRow } from '@/lib/flux/types';
import { hasRenderableFluxPageConfig } from '@/lib/flux/coercePageConfig';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-300',
  live: 'bg-green-500/20 text-green-300',
  archived: 'bg-gray-500/20 text-gray-400',
};

export default function FluxDashboard() {
  const { account } = useAccount();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<FluxCampaignRow[]>([]);
  const [recentPages, setRecentPages] = useState<FluxProspectPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        getFluxCampaigns(account.id),
        getRecentFluxPages(account.id, 10),
      ]);
      setCampaigns(c);
      setRecentPages(p);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!account || creating) return;
    setCreating(true);
    try {
      const campaign = await createFluxCampaign(account.id, 'New Campaign');
      router.push(`/flux/campaigns/${campaign.id}` as Href);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, flexGrow: 1 }}>
      <View className="flex-row items-center justify-between mb-6">
        <Text className="text-white text-2xl font-instrument-semibold">Flux</Text>
        <Button size="sm" onPress={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'New Campaign'}
        </Button>
      </View>

      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">Campaigns</Text>
      {campaigns.length === 0 ? (
        <View className="border border-[#2A2A2A] rounded-xl p-6 items-center mb-8">
          <Text className="text-gray-400 text-sm font-instrument">No campaigns yet. Create one to get started.</Text>
        </View>
      ) : (
        <View className="gap-3 mb-8">
          {campaigns.map((c) => (
            <Pressable
              key={c.id}
              className="border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A]"
              onPress={() => router.push(`/flux/campaigns/${c.id}` as Href)}
            >
              <Text className="text-white text-base font-instrument-semibold mb-1">{c.name}</Text>
              {c.offer_description && (
                <Text className="text-gray-400 text-sm font-instrument" numberOfLines={2}>
                  {c.offer_description}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}

      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">Recent Pages</Text>
      {recentPages.length === 0 ? (
        <View className="border border-[#2A2A2A] rounded-xl p-6 items-center">
          <Text className="text-gray-400 text-sm font-instrument">No prospect pages yet.</Text>
        </View>
      ) : (
        <View className="gap-2">
          {recentPages.map((p) => (
            <Pressable
              key={p.id}
              className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A] flex-row items-center justify-between"
              onPress={() => router.push(`/flux/prospects/${p.prospect_id}` as Href)}
            >
              <View className="flex-1 mr-3">
                <Text className="text-white text-sm font-instrument-semibold">/p/{p.slug}</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <View className={`px-2 py-0.5 rounded-md ${STATUS_COLORS[p.status] || ''}`}>
                  <Text className="text-xs font-instrument-semibold">{p.status}</Text>
                </View>
                {p.status === 'live' && !hasRenderableFluxPageConfig(p.page_config) && (
                  <View className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30">
                    <Text className="text-xs font-instrument-semibold text-amber-200">no content</Text>
                  </View>
                )}
              </View>
              <Text className="text-gray-500 text-xs ml-3 font-instrument">{p.view_count} views</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
