import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { Button } from '@/components/ui/button';
import { getFluxProspectsByAccount, getFluxCampaigns } from '@/lib/supabase/services/flux';
import type { FluxProspectRow, FluxCampaignRow } from '@/lib/flux/types';

export default function FluxProspectsList() {
  const { account } = useAccount();
  const router = useRouter();
  const [prospects, setProspects] = useState<FluxProspectRow[]>([]);
  const [campaigns, setCampaigns] = useState<FluxCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        getFluxProspectsByAccount(account.id),
        getFluxCampaigns(account.id),
      ]);
      setProspects(p);
      setCampaigns(c);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  const campaignNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c.id, c.name);
    return m;
  }, [campaigns]);

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
        <Text className="text-white text-xl font-instrument-semibold">Prospects</Text>
        <Button size="sm" onPress={() => router.push('/flux/prospects/new' as Href)}>
          New prospect
        </Button>
      </View>

      {campaigns.length === 0 ? (
        <View className="border border-[#2A2A2A] rounded-xl p-6 mb-4">
          <Text className="text-gray-400 text-sm font-instrument text-center">
            Create a campaign first, then add prospects from a campaign or here.
          </Text>
        </View>
      ) : null}

      {prospects.length === 0 ? (
        <View className="border border-[#2A2A2A] rounded-xl p-8 items-center">
          <Text className="text-gray-400 text-sm font-instrument text-center mb-4">
            No prospects yet. Add one for a campaign.
          </Text>
          <Button onPress={() => router.push('/flux/prospects/new' as Href)}>New prospect</Button>
        </View>
      ) : (
        <View className="gap-3">
          {prospects.map((p) => (
            <Pressable
              key={p.id}
              className="border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A]"
              onPress={() => router.push(`/flux/prospects/${p.id}` as Href)}
            >
              <Text className="text-white text-base font-instrument-semibold mb-0.5">{p.name}</Text>
              <Text className="text-gray-400 text-sm font-instrument mb-1">{p.company}</Text>
              <Text className="text-gray-500 text-xs font-instrument">
                {campaignNameById.get(p.campaign_id) ?? 'Campaign'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
