import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { Button } from '@/components/ui/button';
import { getFluxCampaigns, createFluxCampaign } from '@/lib/supabase/services/flux';
import type { FluxCampaignRow } from '@/lib/flux/types';

export default function FluxCampaignsList() {
  const { account } = useAccount();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<FluxCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      setCampaigns(await getFluxCampaigns(account.id));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

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
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Pressable onPress={() => router.push('/flux' as Href)} className="mb-4">
        <Text className="text-gray-400 text-sm font-instrument">← Dashboard</Text>
      </Pressable>

      <View className="flex-row items-center justify-between mb-6">
        <Text className="text-white text-xl font-instrument-semibold">Campaigns</Text>
        <Button size="sm" onPress={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'New campaign'}
        </Button>
      </View>

      {campaigns.length === 0 ? (
        <View className="border border-[#2A2A2A] rounded-xl p-8 items-center">
          <Text className="text-gray-400 text-sm font-instrument text-center mb-4">
            No campaigns yet. Create one to build templates and prospects.
          </Text>
          <Button onPress={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create campaign'}
          </Button>
        </View>
      ) : (
        <View className="gap-3">
          {campaigns.map((c) => (
            <Pressable
              key={c.id}
              className="border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A]"
              onPress={() => router.push(`/flux/campaigns/${c.id}` as Href)}
            >
              <Text className="text-white text-base font-instrument-semibold mb-1">{c.name}</Text>
              {c.offer_description ? (
                <Text className="text-gray-400 text-sm font-instrument" numberOfLines={2}>
                  {c.offer_description}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
