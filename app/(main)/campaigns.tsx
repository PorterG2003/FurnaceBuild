import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, useWindowDimensions } from 'react-native';
import { PageLayout, PageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { IconButton } from '@/components/ui/icon-button';
import { StatColumn } from '@/components/ui/StatColumn';
import { Alert, EmptyState, useSmoothLoading, useToast } from '@/components/ui/feedback';
import { CampaignListSkeleton } from '@/components/skeletons';
import { BaseModal, ConfirmDeleteModal } from '@/components/ui/modals';
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
  ExclamationTriangleIcon,
} from 'react-native-heroicons/outline';
import { ProgressDial } from '@/components/ui/progress-dial';
import { isSmartleadCampaign } from '@/lib/campaigns/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import { CampaignStatusPill } from '@/components/campaigns';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';

const STAT_COLUMN_WIDTH = 72;
const POSITIVE_COLUMN_WIDTH = 88;
/** Below this width (mobile only), use extra-small stat variant and tighter layout */
const EXTRA_NARROW_BREAKPOINT = 360;

interface CreateCampaignModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  isLoading: boolean;
}

function CreateCampaignModal({ visible, onClose, onCreate, isLoading }: CreateCampaignModalProps) {
  const { toast } = useToast();
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
      toast.error(err.message || 'Failed to create campaign');
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
            <Button
              variant="secondary"
              onPress={handleClose}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>
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
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white border-[#FFFFFF4D] bg-[#FFFFFF0D]"
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          autoFocus
        />
      </View>
      <Text className="text-gray-500 font-instrument text-sm mb-4">
        Next you'll configure your flow, schedule, and mailboxes in Mission Control.
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

function CampaignCard({ campaign, stats, onDelete, isDeleting }: CampaignCardProps) {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSmartleadModal, setShowSmartleadModal] = useState(false);
  const isMobileLayout = screenWidth < LAYOUT_BREAKPOINT;
  const isDraft = campaign.status === 'draft';
  const draftHasFlow = hasFlow(campaign);
  const isSmartlead = isSmartleadCampaign(campaign);

  const sentCount = stats?.sentCount ?? 0;
  const repliedCount = stats?.repliedCount ?? 0;
  const positiveReplyCount = stats?.positiveReplyCount ?? 0;
  const bounceCount = stats?.bounceCount ?? 0;
  const enrollmentCount = stats?.enrollmentCount ?? 0;
  const contactedCount = stats?.contactedEnrollmentCount ?? 0;
  const terminalCount = stats?.terminalEnrollmentCount ?? 0;
  // Use max(contacted, terminal) for "reached" so enrollments that are terminal without
  // a sent email (e.g. stopped before first send) still count toward completion.
  const reachedCount = Math.max(contactedCount, terminalCount);
  const completionValue = reachedCount + terminalCount;
  const completionTotal = enrollmentCount > 0 ? enrollmentCount * 2 : 1;

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'campaigns.tsx:CampaignCard',message:'Dial inputs',data:{campaignId:campaign.id?.slice(0,8),contactedCount,terminalCount,reachedCount,completionValue,completionTotal},timestamp:Date.now(),hypothesisId:'D',runId:'verify'})}).catch(()=>{});
  // #endregion

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleContinueSetup = () => {
    if (isSmartlead) { setShowSmartleadModal(true); return; }
    router.push({ pathname: '/campaigns/[id]/mission-control', params: { id: campaign.id } });
  };

  const handleOpen = () => {
    router.push({ pathname: '/campaigns/[id]', params: { id: campaign.id } });
  };

  const handleDelete = async () => {
    await onDelete(campaign.id);
    setShowDeleteModal(false);
  };

  const handleEditFlow = () => {
    if (isSmartlead) { setShowSmartleadModal(true); return; }
    router.push({ pathname: '/builder', params: { campaignId: campaign.id } });
  };

  const repliedPct = sentCount > 0 ? Math.round((repliedCount / sentCount) * 100) : 0;
  const positivePct = repliedCount > 0 ? Math.round((positiveReplyCount / repliedCount) * 100) : 0;

  const statCells = (
    <>
      <View className="w-[72px] items-center">
        <StatColumn icon={PaperAirplaneIcon} value={sentCount} label="Sent" color="#a78bfa" />
      </View>
      <View className="w-[72px] items-center">
        <StatColumn
          icon={ArrowUturnLeftIcon}
          value={repliedCount}
          pct={repliedPct}
          label="Replied"
          color="#14b8a6"
        />
      </View>
      <View className="w-[88px] items-center">
        <StatColumn
          icon={CheckCircleIcon}
          value={positiveReplyCount}
          pct={positivePct}
          label="Positive Reply"
          color="#10b981"
        />
      </View>
      <View className="w-[72px] items-center">
        <StatColumn icon={ExclamationTriangleIcon} value={bounceCount} label="Bounced" color="#f59e0b" />
      </View>
    </>
  );

  const campaignBlockDesktop = (
    <View className="flex-row gap-3 flex-1 max-w-[35%] min-w-0">
      <View className="mt-0.5">
        <ProgressDial
          value={completionValue}
          total={completionTotal}
          showAsPercentage
          color="#10b981"
          size={56}
        />
      </View>
      <View className="flex-1 min-w-0">
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

  const statsBlockDesktop = (
    <View className="flex-row flex-none basis-[40%] shrink-0 justify-around">
      {statCells}
    </View>
  );

  const toolsBlockDesktop = (
    <View className="flex-row gap-2 items-center">
      {isDraft && !isSmartlead && (
        <Button
          onPress={handleContinueSetup}
          className="rounded-lg bg-[#f85102]"
        >
          Mission Control
        </Button>
      )}
      {isSmartlead ? (
        <Tooltip content={<Text className="text-gray-300 font-instrument text-xs">Only the stats dashboard is available for Smartlead campaigns.</Text>}>
          <View className="opacity-50">
            <IconButton
              icon={PencilIcon}
              variant="secondary"
              onPress={handleEditFlow}
              className="min-w-[44px] min-h-[44px]"
            />
          </View>
        </Tooltip>
      ) : (
        <IconButton
          icon={PencilIcon}
          variant="secondary"
          onPress={(e) => { e?.stopPropagation?.(); handleEditFlow(); }}
          className="min-w-[44px] min-h-[44px]"
        />
      )}
      <IconButton
        icon={TrashIcon}
        variant="destructive"
        onPress={(e) => { e?.stopPropagation?.(); setShowDeleteModal(true); }}
        disabled={isDeleting}
        className="min-w-[44px] min-h-[44px]"
      />
    </View>
  );

  const handleCardPress = isMobileLayout ? handleOpen : (isSmartlead ? handleOpen : (isDraft ? handleContinueSetup : handleOpen));
  const isExtraNarrow = isMobileLayout && screenWidth < EXTRA_NARROW_BREAKPOINT;
  const statSize = isExtraNarrow ? 'xs' : 'default';

  const smartleadModal = isSmartlead ? (
    <SmartleadRestrictedModal
      visible={showSmartleadModal}
      onClose={() => setShowSmartleadModal(false)}
      campaignId={campaign.id}
      isOnStatsPage={false}
    />
  ) : null;

  if (isMobileLayout) {
    return (
      <>
        <Card variant="card" onPress={handleCardPress} className="mb-4">
            {/* Block 1 — Identity (smaller name on mobile to reduce cut-off) */}
            <View className="flex-row gap-3 mb-3">
              <View className="mt-0.5">
                <ProgressDial
                  value={completionValue}
                  total={completionTotal}
                  showAsPercentage
                  color="#10b981"
                  size={48}
                />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-white font-instrument-semibold text-base mb-1" numberOfLines={2}>
                  {campaign.name}
                </Text>
                <Text className="text-gray-500 font-instrument text-xs">
                  Created {formatDate(campaign.created_at)}
                </Text>
                {isDraft && (
                  <Text className="text-gray-400 font-instrument text-xs mt-1">
                    {draftHasFlow
                      ? 'Next: Configure schedule & mailboxes to start'
                      : 'Next: Build your flow'}
                  </Text>
                )}
              </View>
            </View>
            {/* Block 2 — Stats: 4 columns with gap so first/last line up on the edges; margin above, no margin below */}
            <View className="flex-row justify-between items-start mt-3 gap-3 px-2">
              <View className="items-center">
                <StatColumn icon={PaperAirplaneIcon} value={sentCount} label="Sent" color="#a78bfa" size={statSize} />
              </View>
              <View className="items-center">
                <StatColumn
                  icon={ArrowUturnLeftIcon}
                  value={repliedCount}
                  pct={repliedPct}
                  label="Replied"
                  color="#14b8a6"
                  size={statSize}
                />
              </View>
              <View className="items-center">
                <StatColumn
                  icon={CheckCircleIcon}
                  value={positiveReplyCount}
                  pct={positivePct}
                  label="Positive"
                  color="#10b981"
                  size={statSize}
                />
              </View>
              <View className="items-center">
                <StatColumn icon={ExclamationTriangleIcon} value={bounceCount} label="Bounced" color="#f59e0b" size={statSize} />
              </View>
            </View>
        </Card>
        {smartleadModal}
      </>
    );
  }

  return (
    <>
      <Card variant="card" onPress={handleCardPress} className="mb-4 relative">
          <View className="flex-row items-start gap-4">
            {campaignBlockDesktop}
            {statsBlockDesktop}
          </View>
          <View className="absolute right-4 top-4">
            {toolsBlockDesktop}
          </View>
        </Card>
      <ConfirmDeleteModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete campaign?"
        itemName={campaign.name}
        confirmLabel="Delete campaign"
        isLoading={isDeleting}
        requireConfirmation={false}
      />
      {smartleadModal}
    </>
  );
}

export default function CampaignsPage() {
  const { user, account } = useAccount();
  const { toast } = useToast();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStats, setCampaignStats] = useState<Record<string, CampaignStats>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const showSkeleton = useSmoothLoading(isLoading);
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;

  const loadCampaigns = async () => {
    if (!account?.id) return;

    setIsLoading(true);
    setError('');
    try {
      const data = await getCampaigns({ accountId: account.id });
      setCampaigns(data);
      const stats = await getCampaignStatsForCampaigns(data.map((c) => c.id));
      // #region agent log
      const firstCampaignId = data[0]?.id;
      fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'campaigns.tsx:loadCampaigns',message:'List page received stats',data:{campaignsLength:data.length,firstCampaignId,statsKeys:Object.keys(stats).length,statsForFirst:firstCampaignId?stats[firstCampaignId]:null,hasStatsForFirst:firstCampaignId?firstCampaignId in stats:false},timestamp:Date.now(),hypothesisId:'B_E'})}).catch(()=>{});
      // #endregion
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
    if (!user?.id) {
      throw new Error('User not authenticated');
    }
    if (!account?.id) {
      throw new Error('No account selected');
    }

    setIsCreating(true);
    try {
      const newCampaign = await createCampaign({
        name,
        owner_id: user.id,
        account_id: account.id,
        organization_id: null,
        status: 'draft',
      });
      await loadCampaigns();
      router.push({
        pathname: '/campaigns/[id]/mission-control',
        params: { id: newCampaign.id },
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
      toast.error(err.message || 'Failed to delete campaign');
      console.error('Error deleting campaign:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const newCampaignButton = (
    <Pressable
      onPress={() => setShowCreateModal(true)}
      className="rounded-xl px-6 py-3 flex-row items-center justify-center gap-2 bg-[#f85102]"
    >
      <PlusIcon size={20} color="#ffffff" />
      <Text className="text-white font-instrument-medium text-base">
        New Campaign
      </Text>
    </Pressable>
  );

  const newCampaignButtonMobile = (
    <MobileHeaderButton
      variant="add"
      onPress={() => setShowCreateModal(true)}
      accessibilityLabel="New campaign"
    />
  );

  return (
    <PageLayout>
      <PageHeader
        title="Campaigns"
        subtitle="Manage your marketing campaigns"
        primaryAction={isMobile ? newCampaignButtonMobile : newCampaignButton}
      />
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
      {(isLoading || showSkeleton) ? (
        <CampaignListSkeleton />
      ) : campaigns.length === 0 ? (
        /* Empty State */
        <EmptyState
          title="No campaigns yet"
          description="Create your first campaign to get started with marketing automation"
          action={
            <Pressable
              onPress={() => setShowCreateModal(true)}
              className={`rounded-xl px-6 py-3 flex-row items-center justify-center gap-2 bg-[#f85102] ${isMobile ? 'w-full' : ''}`}
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
