import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, TouchableOpacity, useWindowDimensions } from 'react-native';
import { PageLayout } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Alert, LoadingState, EmptyState } from '@/components/ui/feedback';
import { BaseModal } from '@/components/ui/modals';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { useRouter } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { getCampaigns, createCampaign, deleteCampaign, getCampaignStatsForCampaigns, type CampaignStats } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import {
  PlusIcon,
  TrashIcon,
  PencilIcon,
  PaperAirplaneIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
} from 'react-native-heroicons/outline';
import { ProgressDial } from '@/components/ui/progress-dial';

const STAT_COLUMN_WIDTH = 72;
const POSITIVE_COLUMN_WIDTH = 88;
const STAT_COLUMN_GAP = 16;
const NARROW_BREAKPOINT = 600;

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
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Create New Campaign"
      description="Give your campaign a name to get started"
      maxWidth="md"
      footer={
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
      }
    >
      <View className="mb-2">
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
      <Text className="text-gray-500 font-instrument text-sm mb-4">
        Next you'll build your flow, then set schedule and mailboxes to go live.
      </Text>
      {error ? (
        <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <Text className="text-red-400 text-center font-instrument-medium text-sm">
            {error}
          </Text>
        </View>
      ) : null}
    </BaseModal>
  );
}

interface CampaignCardProps {
  campaign: Campaign;
  stats?: CampaignStats;
  onDelete: (id: string) => Promise<void>;
  isDeleting: boolean;
}

function hasFlow(campaign: Campaign): boolean {
  if (!campaign?.flow_data) return false;
  try {
    const fd =
      typeof campaign.flow_data === 'string'
        ? JSON.parse(campaign.flow_data)
        : campaign.flow_data;
    const nodes = Array.isArray((fd as any)?.nodes) ? (fd as any).nodes : [];
    return nodes.length > 0;
  } catch {
    return false;
  }
}

function CampaignStatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#374151', text: '#9CA3AF' },
    running: { bg: '#065F46', text: '#10B981' },
    paused: { bg: '#78350F', text: '#F59E0B' },
    stopped: { bg: '#44403C', text: '#A8A29E' },
  };
  const s = status?.toLowerCase() in colors ? status.toLowerCase() : 'draft';
  const { bg, text } = colors[s] || colors.draft;
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
      }}
    >
      <Text style={{ color: text, fontSize: 12, fontWeight: '500' }}>
        {status === 'draft' ? 'Draft' : status === 'running' ? 'Running' : status === 'paused' ? 'Paused' : 'Stopped'}
      </Text>
    </View>
  );
}

function CampaignCard({ campaign, stats, onDelete, isDeleting }: CampaignCardProps) {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isNarrow = screenWidth < NARROW_BREAKPOINT;
  const isDraft = campaign.status === 'draft';
  const draftHasFlow = hasFlow(campaign);

  const sentCount = stats?.sentCount ?? 0;
  const repliedCount = stats?.repliedCount ?? 0;
  const positiveReplyCount = stats?.positiveReplyCount ?? 0;
  const enrollmentCount = stats?.enrollmentCount ?? 0;
  const sentTotal = enrollmentCount > 0 ? enrollmentCount : 1;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleContinueSetup = () => {
    if (isDraft && !draftHasFlow) {
      router.push({ pathname: '/builder', params: { campaignId: campaign.id } });
    } else {
      router.push({ pathname: '/campaigns/[id]', params: { id: campaign.id } });
    }
  };

  const handleOpen = () => {
    router.push({ pathname: '/campaigns/[id]', params: { id: campaign.id } });
  };

  const handleDelete = async () => {
    await onDelete(campaign.id);
    setShowDeleteConfirm(false);
  };

  const handleEditFlow = () => {
    router.push({ pathname: '/builder', params: { campaignId: campaign.id } });
  };

  const repliedPct = sentCount > 0 ? Math.round((repliedCount / sentCount) * 100) : 0;
  const positivePct = repliedCount > 0 ? Math.round((positiveReplyCount / repliedCount) * 100) : 0;

  const StatColumn = ({
    icon: Icon,
    value,
    pct,
    label,
    color,
  }: {
    icon: React.ComponentType<{ size?: number; color?: string }>;
    value: number;
    pct?: number;
    label: string;
    color: string;
  }) => (
    <View style={{ alignItems: 'center' }}>
      <View style={{ marginBottom: 4 }}>
        <Icon size={16} color={color} />
      </View>
      <Text className="font-instrument-semibold text-base" style={{ color }}>
        {value}
        {pct !== undefined ? (
          <Text className="text-gray-500 font-instrument text-sm"> ({pct}%)</Text>
        ) : null}
      </Text>
      <Text className="text-gray-500 font-instrument text-xs mt-0.5">{label}</Text>
    </View>
  );

  const campaignBlock = (
    <View className="flex-row" style={{ gap: 12, flex: isNarrow ? undefined : 1, maxWidth: isNarrow ? undefined : '35%', minWidth: 0 }}>
      <View style={{ marginTop: 2 }}>
        <ProgressDial
          value={sentCount}
          total={sentTotal}
          showAsPercentage
          color="#10b981"
          size={56}
        />
      </View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center gap-2 mb-1 flex-wrap">
          <Text className="text-white font-instrument-semibold text-lg">
            {campaign.name}
          </Text>
          <CampaignStatusPill status={campaign.status || 'draft'} />
        </View>
        {isDraft && (
          <Text className="text-gray-400 font-instrument text-sm mb-1">
            {draftHasFlow
              ? 'Next: Configure schedule & mailboxes to start'
              : 'Next: Build your flow'}
          </Text>
        )}
        <Text className="text-gray-500 font-instrument text-sm">
          Created {formatDate(campaign.created_at)}
        </Text>
      </View>
    </View>
  );

  const statsBlock = (
    <View
      style={{
        flexDirection: 'row',
        flex: isNarrow ? undefined : 0,
        flexBasis: isNarrow ? undefined : '40%',
        flexShrink: isNarrow ? undefined : 0,
        justifyContent: isNarrow ? 'flex-start' : 'space-around',
        gap: isNarrow ? STAT_COLUMN_GAP : 0,
      }}
    >
      <View style={{ width: STAT_COLUMN_WIDTH, alignItems: 'center' }}>
        <StatColumn icon={PaperAirplaneIcon} value={sentCount} label="Sent" color="#a78bfa" />
      </View>
      <View style={{ width: STAT_COLUMN_WIDTH, alignItems: 'center' }}>
        <StatColumn
          icon={ArrowUturnLeftIcon}
          value={repliedCount}
          pct={repliedPct}
          label="Replied"
          color="#14b8a6"
        />
      </View>
      <View style={{ width: POSITIVE_COLUMN_WIDTH, alignItems: 'center' }}>
        <StatColumn
          icon={CheckCircleIcon}
          value={positiveReplyCount}
          pct={positivePct}
          label="Positive Reply"
          color="#10b981"
        />
      </View>
    </View>
  );

  const toolsBlock = showDeleteConfirm ? (
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
          <View className="flex-row gap-2 items-center">
            {isDraft && (
              <Pressable
                onPress={handleContinueSetup}
                className="px-4 py-2 rounded-lg bg-brand-orange"
                style={{ backgroundColor: '#f85102' }}
              >
                <Text className="text-white font-instrument-medium text-sm">
                  Continue setup
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleEditFlow}
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
  );

  const handleCardPress = isDraft ? handleContinueSetup : handleOpen;

  if (isNarrow) {
    return (
      <Pressable onPress={handleCardPress}>
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-4">
          <View className="flex-row items-start justify-between" style={{ marginBottom: 12 }}>
            {campaignBlock}
            {toolsBlock}
          </View>
          {statsBlock}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={handleCardPress}>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-4" style={{ position: 'relative' }}>
        <View className="flex-row items-start" style={{ gap: 16 }}>
          {campaignBlock}
          {statsBlock}
        </View>
        <View style={{ position: 'absolute', right: 16, top: 16 }}>
          {toolsBlock}
        </View>
      </View>
    </Pressable>
  );
}

export default function CampaignsPage() {
  const { user } = useAuthenticator();
  const { account } = useAccount();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStats, setCampaignStats] = useState<Record<string, CampaignStats>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadCampaigns = async () => {
    if (!account?.id) return;

    setIsLoading(true);
    setError('');
    try {
      const data = await getCampaigns({ accountId: account.id });
      setCampaigns(data);
      const stats = await getCampaignStatsForCampaigns(data.map((c) => c.id));
      setCampaignStats(stats);
    } catch (err: any) {
      setError(err.message || 'Failed to load campaigns');
      console.error('Error loading campaigns:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, [account?.id]);

  const handleCreateCampaign = async (name: string) => {
    if (!user?.userId) {
      throw new Error('User not authenticated');
    }
    if (!account?.id) {
      throw new Error('No account selected');
    }

    setIsCreating(true);
    try {
      const newCampaign = await createCampaign({
        name,
        owner_id: user.userId,
        account_id: account.id,
        organization_id: null,
        status: 'draft',
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
    <PageLayout>
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
        <Alert
          variant="error"
          message={error}
          actionText="Try again"
          onAction={loadCampaigns}
        />
      ) : null}
      {/* Loading State */}
      {isLoading ? (
        <LoadingState message="Loading campaigns..." />
      ) : campaigns.length === 0 ? (
        /* Empty State */
        <EmptyState
          title="No campaigns yet"
          description="Create your first campaign to get started with marketing automation"
          action={
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
          }
        />
      ) : (
        /* Campaigns List */
        <View>
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              stats={campaignStats[campaign.id]}
              onDelete={handleDeleteCampaign}
              isDeleting={deletingId === campaign.id}
            />
          ))}
        </View>
      )}
      {/* Create Campaign Modal */}
      <CreateCampaignModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateCampaign}
        isLoading={isCreating}
      />
    </PageLayout>
  );
}
