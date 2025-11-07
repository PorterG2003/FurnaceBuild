import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, Modal, Pressable, ActivityIndicator, TouchableOpacity } from 'react-native';
import { NavBar } from '@/components/ui/NavBar';
import { Background } from '@/components/ui/Background';
import { Button } from '@/components/ui/button';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { useRouter } from 'expo-router';
import { getCampaigns, createCampaign, deleteCampaign } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import { useBackground } from '@/contexts/BackgroundContext';
import { PlusIcon, TrashIcon, PencilIcon } from 'react-native-heroicons/outline';

interface CreateCampaignModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  isLoading: boolean;
}

function CreateCampaignModal({ visible, onClose, onCreate, isLoading }: CreateCampaignModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Campaign name is required');
      return;
    }

    setError('');
    try {
      await onCreate(name.trim());
      setName('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create campaign');
    }
  };

  const handleClose = () => {
    setName('');
    setError('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
        onPress={handleClose}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="bg-[#1A1A1A] rounded-2xl border border-[#2A2A2A] p-6 w-full max-w-md">
            <Text className="text-2xl font-instrument-semibold mb-2 text-white">
              Create New Campaign
            </Text>
            <Text className="text-gray-400 mb-6 font-instrument text-sm">
              Give your campaign a name to get started
            </Text>

            <View className="mb-4">
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Campaign Name</Text>
              <TextInput
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  setError('');
                }}
                placeholder="Enter campaign name"
                placeholderTextColor="#666"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={{
                  borderColor: '#FFFFFF4D',
                  backgroundColor: '#FFFFFF0D',
                  color: '#FFFFFF',
                  borderWidth: 1,
                }}
                selectionColor="#FF4D00"
                underlineColorAndroid="transparent"
                autoFocus
              />
            </View>

            {error ? (
              <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
                <Text className="text-red-400 text-center font-instrument-medium text-sm">
                  {error}
                </Text>
              </View>
            ) : null}

            <View className="flex-row gap-3">
              <View className="flex-1">
                <TouchableOpacity
                  onPress={handleClose}
                  disabled={isLoading}
                  className="border border-[#3A3A3A] rounded-xl px-6 py-3 items-center justify-center"
                  style={{
                    borderWidth: 1,
                    borderColor: '#3A3A3A',
                    opacity: isLoading ? 0.5 : 1,
                  }}
                >
                  <Text className="text-white font-instrument-medium text-base">
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
              <View className="flex-1">
                <Button
                  onPress={handleCreate}
                  disabled={isLoading}
                >
                  {isLoading ? 'Creating...' : 'Create Campaign'}
                </Button>
              </View>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface CampaignCardProps {
  campaign: Campaign;
  onDelete: (id: string) => Promise<void>;
  isDeleting: boolean;
}

function CampaignCard({ campaign, onDelete, isDeleting }: CampaignCardProps) {
  const router = useRouter();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleDelete = async () => {
    await onDelete(campaign.id);
    setShowDeleteConfirm(false);
  };

  const handleEdit = () => {
    router.push({
      pathname: '/builder',
      params: { campaignId: campaign.id },
    });
  };

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-4">
          <Text className="text-white font-instrument-semibold text-lg mb-2">
            {campaign.name}
          </Text>
          <Text className="text-gray-400 font-instrument text-sm">
            Created {formatDate(campaign.created_at)}
          </Text>
        </View>
        {showDeleteConfirm ? (
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => setShowDeleteConfirm(false)}
              className="px-3 py-1.5 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
            >
              <Text className="text-white font-instrument-medium text-sm">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleDelete}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30"
            >
              <Text className="text-red-400 font-instrument-medium text-sm">
                {isDeleting ? 'Deleting...' : 'Confirm'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-row gap-2">
            <Pressable
              onPress={handleEdit}
              className="p-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
            >
              <PencilIcon size={18} color="#f85102" />
            </Pressable>
            <Pressable
              onPress={() => setShowDeleteConfirm(true)}
              className="p-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
              disabled={isDeleting}
            >
              <TrashIcon size={18} color="#ef4444" />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

export default function CampaignsPage() {
  const { user } = useAuthenticator();
  const router = useRouter();
  const { setVariant } = useBackground();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadCampaigns = async () => {
    if (!user?.userId) return;

    setIsLoading(true);
    setError('');
    try {
      const data = await getCampaigns({ ownerId: user.userId });
      setCampaigns(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load campaigns');
      console.error('Error loading campaigns:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, [user?.userId]);

  useEffect(() => {
    // Set solid background for campaigns page
    setVariant('solid');
    
    // Cleanup: reset to solid when leaving
    return () => {
      setVariant('solid');
    };
  }, [setVariant]);

  const handleCreateCampaign = async (name: string) => {
    if (!user?.userId) {
      throw new Error('User not authenticated');
    }

    setIsCreating(true);
    try {
      const newCampaign = await createCampaign({
        name,
        owner_id: user.userId,
        organization_id: null,
      });
      await loadCampaigns();
      // Navigate to builder after successful creation
      router.push({
        pathname: '/builder',
        params: { campaignId: newCampaign.id },
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteCampaign(id);
      await loadCampaigns();
    } catch (err: any) {
      setError(err.message || 'Failed to delete campaign');
      console.error('Error deleting campaign:', err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      
      {/* Main Content Area */}
      <View className="flex-1 relative">
        <Background />

        {/* Content */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between mb-6">
            <View>
              <Text className="text-3xl font-instrument-semibold text-white mb-2">
                Campaigns
              </Text>
              <Text className="text-gray-400 font-instrument">
                Manage your marketing campaigns
              </Text>
            </View>
            <Pressable
              onPress={() => setShowCreateModal(true)}
              className="bg-brand-orange rounded-xl px-6 py-3 flex-row items-center gap-2"
              style={{ backgroundColor: '#f85102' }}
            >
              <PlusIcon size={20} color="#ffffff" />
              <Text className="text-white font-instrument-medium text-base">
                New Campaign
              </Text>
            </Pressable>
          </View>

          {/* Error Message */}
          {error ? (
            <View className="mb-4 p-4 bg-red-500/20 border border-red-500/30 rounded-xl">
              <Text className="text-red-400 font-instrument-medium text-sm">
                {error}
              </Text>
              <Pressable
                onPress={loadCampaigns}
                className="mt-2"
              >
                <Text className="text-red-300 font-instrument text-sm underline">
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Loading State */}
          {isLoading ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color="#f85102" />
              <Text className="text-gray-400 font-instrument mt-4">
                Loading campaigns...
              </Text>
            </View>
          ) : campaigns.length === 0 ? (
            /* Empty State */
            <View className="items-center justify-center py-20">
              <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-8 max-w-md w-full items-center">
                <Text className="text-white font-instrument-semibold text-xl mb-2">
                  No campaigns yet
                </Text>
                <Text className="text-gray-400 font-instrument text-center mb-6">
                  Create your first campaign to get started with marketing automation
                </Text>
                <Pressable
                  onPress={() => setShowCreateModal(true)}
                  className="bg-brand-orange rounded-xl px-6 py-3 flex-row items-center gap-2"
                  style={{ backgroundColor: '#f85102' }}
                >
                  <PlusIcon size={20} color="#ffffff" />
                  <Text className="text-white font-instrument-medium text-base">
                    Create Campaign
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            /* Campaigns List */
            <View>
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onDelete={handleDeleteCampaign}
                  isDeleting={deletingId === campaign.id}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Create Campaign Modal */}
      <CreateCampaignModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateCampaign}
        isLoading={isCreating}
      />
    </View>
  );
}
