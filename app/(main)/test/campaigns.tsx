import { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { getUserByExternalId } from '@/lib/supabase/services/users';
import { getTestCampaigns } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import { TrashIcon, ArrowRightIcon } from 'react-native-heroicons/outline';
import { format } from 'date-fns';

export default function TestCampaignsPage() {
  const router = useRouter();
  const { user } = useAuthenticator();
  const [loading, setLoading] = useState(true);
  const [testCampaigns, setTestCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadTestCampaigns = useCallback(async () => {
    if (!user?.userId) {
      setError('User not authenticated');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const userProfile = await getUserByExternalId(user.userId);
      if (!userProfile) {
        setError('User profile not found');
        setLoading(false);
        return;
      }

      const campaigns = await getTestCampaigns(userProfile.id);
      setTestCampaigns(campaigns);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [user?.userId]);

  useEffect(() => {
    loadTestCampaigns();
  }, [loadTestCampaigns]);

  const handleViewCampaign = (campaignId: string) => {
    router.push(`/test/campaign-flow/${campaignId}` as any);
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    // TODO: Implement delete functionality
    console.log('Delete campaign:', campaignId);
  };

  if (loading) {
    return (
      <PageLayout>
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#f85102" />
          <Text className="mt-4 text-gray-400 font-instrument">Loading test campaigns...</Text>
        </View>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {/* Header */}
      <View className="mb-6">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-2xl font-instrument-semibold text-white">
            Test Campaigns
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="px-4 py-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text className="text-gray-300 font-instrument text-sm">Back</Text>
          </Pressable>
        </View>
        <Text className="text-gray-400 font-instrument text-sm">
          View and manage your test campaigns
        </Text>
      </View>

      {error && (
        <View className="bg-red-900/20 border border-red-800 rounded-xl p-4 mb-6">
          <Text className="text-red-400 font-instrument text-sm">Error: {error}</Text>
        </View>
      )}

      {testCampaigns.length === 0 ? (
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-8">
          <Text className="text-gray-400 font-instrument text-center text-base mb-2">
            No test campaigns found
          </Text>
          <Text className="text-gray-500 font-instrument text-center text-sm">
            Create a new test campaign to get started
          </Text>
          <Pressable
            onPress={() => router.push('/test/campaign-flow' as any)}
            className="mt-6 bg-brand-orange rounded-lg px-6 py-3 self-center"
            style={{ backgroundColor: '#f85102' }}
            accessibilityRole="button"
            accessibilityLabel="Create new test campaign"
          >
            <Text className="text-white font-instrument-semibold text-base">
              Create Test Campaign
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView>
          <View className="gap-4">
            {testCampaigns.map((campaign) => (
              <View
                key={campaign.id}
                className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6"
              >
                <View className="flex-row items-start justify-between mb-4">
                  <View className="flex-1">
                    <Text className="text-white font-instrument-semibold text-lg mb-2">
                      {campaign.name || 'Unnamed Campaign'}
                    </Text>
                    <Text className="text-gray-400 font-instrument text-sm">
                      Created {format(new Date(campaign.created_at), 'MMM d, yyyy h:mm a')}
                    </Text>
                    {campaign.status && (
                      <View className="mt-2">
                        <View
                          className="self-start px-3 py-1 rounded-md"
                          style={{
                            backgroundColor:
                              campaign.status === 'running'
                                ? '#10b98120'
                                : campaign.status === 'paused'
                                  ? '#f59e0b20'
                                  : '#6b728020',
                          }}
                        >
                          <Text
                            className="text-xs font-instrument-semibold uppercase"
                            style={{
                              color:
                                campaign.status === 'running'
                                  ? '#10b981'
                                  : campaign.status === 'paused'
                                    ? '#f59e0b'
                                    : '#6b7280',
                            }}
                          >
                            {campaign.status}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                </View>

                <View className="flex-row gap-3 mt-4">
                  <Pressable
                    onPress={() => handleViewCampaign(campaign.id)}
                    className="flex-1 bg-brand-orange rounded-lg px-4 py-3 flex-row items-center justify-center gap-2"
                    style={{ backgroundColor: '#f85102' }}
                    accessibilityRole="button"
                    accessibilityLabel={`View campaign ${campaign.name}`}
                  >
                    <Text className="text-white font-instrument-semibold text-sm">View</Text>
                    <ArrowRightIcon size={16} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteCampaign(campaign.id)}
                    className="px-4 py-3 bg-[#2A2A2A] border border-red-800/50 rounded-lg"
                    accessibilityRole="button"
                    accessibilityLabel={`Delete campaign ${campaign.name}`}
                  >
                    <TrashIcon size={18} color="#ef4444" />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </PageLayout>
  );
}

