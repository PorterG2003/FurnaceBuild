import { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { PageLayout } from '@/components/ui/layout';
import { useAccount } from '@/contexts/AccountContext';
import { supabase } from '@/lib/supabase/client';
import { getCampaigns } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from 'react-native-heroicons/outline';

type ReconcileResult = { type: 'success'; count: number } | { type: 'error'; message: string };

export default function ReconcileStatsPage() {
  const router = useRouter();
  const { account } = useAccount();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const [reconciling, setReconciling] = useState(false);
  const [result, setResult] = useState<ReconcileResult | null>(null);

  const loadCampaigns = useCallback(async () => {
    if (!account?.id) {
      setCampaigns([]);
      setLoadingCampaigns(false);
      return;
    }
    try {
      setLoadingCampaigns(true);
      const list = await getCampaigns({ accountId: account.id });
      setCampaigns(list);
    } catch {
      // non-critical — user can still reconcile all
    } finally {
      setLoadingCampaigns(false);
    }
  }, [account?.id]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const reconcile = async (campaignId: string | null) => {
    setReconciling(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('reconcile_campaign_stats', {
        p_campaign_id: campaignId,
      });
      if (error) {
        setResult({ type: 'error', message: error.message });
      } else {
        setResult({ type: 'success', count: data as number });
      }
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setReconciling(false);
    }
  };

  return (
    <PageLayout>
      {/* Header */}
      <View className="mb-4">
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-xl font-instrument-semibold text-white">
            Reconcile Campaign Stats
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="px-3 py-1.5 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text className="text-gray-300 font-instrument text-xs">Back</Text>
          </Pressable>
        </View>
        <Text className="text-gray-400 font-instrument text-sm">
          Recompute campaign_stats from source tables. Use when list/detail numbers have drifted.
        </Text>
      </View>

      {/* Result banner */}
      {result && (
        <View
          className={`rounded-xl p-4 mb-4 border ${
            result.type === 'success'
              ? 'bg-green-900/20 border-green-800'
              : 'bg-red-900/20 border-red-800'
          }`}
        >
          <View className="flex-row items-center gap-2">
            {result.type === 'success' ? (
              <CheckCircleIcon size={18} color="#22c55e" />
            ) : (
              <ExclamationTriangleIcon size={18} color="#ef4444" />
            )}
            <Text
              className={`font-instrument text-sm ${
                result.type === 'success' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {result.type === 'success'
                ? `Updated ${result.count} campaign_stats row(s).`
                : `Error: ${result.message}`}
            </Text>
          </View>
        </View>
      )}

      {/* Reconcile All */}
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 mb-4">
        <Text className="text-white font-instrument-semibold text-base mb-1">
          All Campaigns
        </Text>
        <Text className="text-gray-400 font-instrument text-xs mb-4">
          Recompute stats for every campaign in the database.
        </Text>
        <Pressable
          onPress={() => reconcile(null)}
          disabled={reconciling}
          className={`flex-row items-center justify-center gap-2 rounded-lg px-4 py-2.5 ${
            reconciling ? 'opacity-50' : ''
          }`}
          style={{ backgroundColor: '#f85102' }}
          accessibilityRole="button"
          accessibilityLabel="Reconcile all campaigns"
        >
          {reconciling ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <ArrowPathIcon size={16} color="#fff" />
          )}
          <Text className="text-white font-instrument-semibold text-sm">
            Reconcile All
          </Text>
        </Pressable>
      </View>

      {/* Reconcile Single Campaign */}
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5">
        <Text className="text-white font-instrument-semibold text-base mb-1">
          Single Campaign
        </Text>
        <Text className="text-gray-400 font-instrument text-xs mb-4">
          Select a campaign to reconcile individually.
        </Text>

        {loadingCampaigns ? (
          <ActivityIndicator size="small" color="#f85102" />
        ) : campaigns.length === 0 ? (
          <Text className="text-gray-500 font-instrument text-xs">No campaigns found.</Text>
        ) : (
          <View className="gap-2">
            {campaigns.map((c) => {
              const isSelected = selectedCampaignId === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setSelectedCampaignId(isSelected ? null : c.id)}
                  className={`rounded-lg px-3 py-2.5 border ${
                    isSelected
                      ? 'border-brand-orange bg-brand-orange/10'
                      : 'border-[#2A2A2A] bg-[#111]'
                  }`}
                  accessibilityRole="button"
                  accessibilityLabel={`Select campaign ${c.name}`}
                >
                  <Text
                    className={`font-instrument text-sm ${
                      isSelected ? 'text-white' : 'text-gray-300'
                    }`}
                    numberOfLines={1}
                  >
                    {c.name || 'Unnamed Campaign'}
                  </Text>
                  <Text className="text-gray-500 font-instrument text-[10px] mt-0.5">
                    {c.id}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => selectedCampaignId && reconcile(selectedCampaignId)}
              disabled={!selectedCampaignId || reconciling}
              className={`mt-2 flex-row items-center justify-center gap-2 rounded-lg px-4 py-2.5 ${
                !selectedCampaignId || reconciling ? 'opacity-50' : ''
              }`}
              style={{ backgroundColor: '#f85102' }}
              accessibilityRole="button"
              accessibilityLabel="Reconcile selected campaign"
            >
              {reconciling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <ArrowPathIcon size={16} color="#fff" />
              )}
              <Text className="text-white font-instrument-semibold text-sm">
                Reconcile Selected
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Info */}
      <View className="mt-6 bg-blue-900/20 border border-blue-800 rounded-xl p-4">
        <Text className="text-blue-400 font-instrument-semibold text-sm mb-1">
          How it works
        </Text>
        <Text className="text-gray-400 font-instrument text-xs leading-5">
          Calls the reconcile_campaign_stats RPC which recomputes sent_count, replied_count,
          positive_reply_count, and bounce_count from message_jobs, email_threads, and events.
        </Text>
      </View>
    </PageLayout>
  );
}
