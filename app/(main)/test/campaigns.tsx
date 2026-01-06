import { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { ConfirmDeleteModal } from '@/components/ui/modals/ConfirmDeleteModal';
import { getUserByExternalId } from '@/lib/supabase/services/users';
import { getTestCampaigns, deleteTestCampaign } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import { TrashIcon, ArrowRightIcon } from 'react-native-heroicons/outline';
import { format } from 'date-fns';

export default function TestCampaignsPage() {
  const router = useRouter();
  const { user } = useAuthenticator();
  const [loading, setLoading] = useState(true);
  const [testCampaigns, setTestCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleDeleteClick = (campaign: Campaign) => {
    setCampaignToDelete(campaign);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!campaignToDelete) return;

    setIsDeleting(true);
    setError(null);

    try {
      await deleteTestCampaign(campaignToDelete.id);
      // Reload campaigns after successful deletion
      await loadTestCampaigns();
      setShowDeleteModal(false);
      setCampaignToDelete(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete test campaign';
      setError(errorMessage);
      console.error('Error deleting test campaign:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setCampaignToDelete(null);
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
      <View className="mb-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-xl font-instrument-semibold text-white mb-1">
              Test Campaigns
            </Text>
            <Text className="text-gray-400 font-instrument text-xs">
              View and manage your test campaigns
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            className="px-3 py-1.5 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text className="text-gray-300 font-instrument text-xs">Back</Text>
          </Pressable>
        </View>
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
          <View className="gap-2">
            {testCampaigns.map((campaign) => (
              <View
                key={campaign.id}
                className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg p-3"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-1 mr-3">
                    <View className="flex-row items-center gap-2 mb-1">
                      <Text className="text-white font-instrument-semibold text-base flex-1">
                        {campaign.name || 'Unnamed Campaign'}
                      </Text>
                      {campaign.status && (
                        <View
                          className="px-2 py-0.5 rounded"
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
                            className="text-[10px] font-instrument-semibold uppercase"
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
                      )}
                    </View>
                    <Text className="text-gray-400 font-instrument text-xs">
                      {format(new Date(campaign.created_at), 'MMM d, yyyy h:mm a')}
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => handleViewCampaign(campaign.id)}
                    className="flex-1 bg-brand-orange rounded-lg px-3 py-2 flex-row items-center justify-center gap-1.5"
                    style={{ backgroundColor: '#f85102' }}
                    accessibilityRole="button"
                    accessibilityLabel={`View campaign ${campaign.name}`}
                  >
                    <Text className="text-white font-instrument-semibold text-xs">View</Text>
                    <ArrowRightIcon size={14} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteClick(campaign)}
                    className="px-3 py-2 bg-[#2A2A2A] border border-red-800/50 rounded-lg"
                    accessibilityRole="button"
                    accessibilityLabel={`Delete campaign ${campaign.name}`}
                  >
                    <TrashIcon size={16} color="#ef4444" />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <ConfirmDeleteModal
        visible={showDeleteModal}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title="Delete Test Campaign"
        itemName={campaignToDelete?.name || 'this test campaign'}
        description="This will permanently delete the test campaign and all associated data including test mailboxes, leads, enrollments, and message jobs. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={isDeleting}
        requireConfirmation={true}
        confirmationText={campaignToDelete?.name || 'DELETE'}
      />
    </PageLayout>
  );
}

