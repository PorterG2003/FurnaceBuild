import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, Pressable, useWindowDimensions } from 'react-native';
import { PageLayout, PageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { StatColumn } from '@/components/ui/StatColumn';
import { Toggle } from '@/components/ui/Toggle';
import { Alert, EmptyState, useSmoothLoading, useToast } from '@/components/ui/feedback';
import { CampaignListSkeleton } from '@/components/skeletons';
import { BaseModal, ConfirmDeleteModal, ModalFooter } from '@/components/ui/modals';
import { useRouter } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import {
  createCampaign,
  duplicateCampaign,
  deleteCampaign,
  getCampaignsListSummary,
  type CampaignListSummary,
} from '@/lib/supabase/services/campaigns';
import type { CampaignTag } from '@/lib/supabase/services/campaign-tags';
import { useCampaignTags } from '@/lib/campaigns/useCampaignTags';
import {
  PlusIcon,
  TrashIcon,
  PencilIcon,
  EllipsisHorizontalIcon,
  PaperAirplaneIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  RocketLaunchIcon,
  TagIcon,
  DocumentDuplicateIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
} from 'react-native-heroicons/outline';
import { ProgressDial } from '@/components/ui/progress-dial';
import { isSmartleadCampaign } from '@/lib/campaigns/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import { CampaignStatusPill, SmartleadBadge, CampaignListFiltersModal } from '@/components/campaigns';
import { IconButton } from '@/components/ui/icon-button';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';
import { RowOverflowMenu } from '@/components/ui/RowOverflowMenu';
import { TagChipRow } from '@/components/tags';
import {
  EMPTY_CAMPAIGN_LIST_FILTERS,
  countActiveCampaignListFilters,
  filterCampaigns,
  type CampaignListFilters,
} from '@/components/campaigns/CampaignListFilterBar';
import { CampaignTagsManager } from '@/components/campaigns/CampaignTagsManager';

const STAT_COLUMN_WIDTH = 72;
const POSITIVE_COLUMN_WIDTH = 88;
/** Below this width (mobile only), use extra-small stat variant and tighter layout */
const EXTRA_NARROW_BREAKPOINT = 360;

interface DuplicateCampaignFormValues {
  name: string;
  copySettings: boolean;
  copyLeads: boolean;
}

interface CreateCampaignModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  isLoading: boolean;
}

interface DuplicateCampaignModalProps {
  visible: boolean;
  sourceCampaign: CampaignListSummary | null;
  onClose: () => void;
  onDuplicate: (values: DuplicateCampaignFormValues) => Promise<void>;
  isLoading: boolean;
}

function buildDuplicateCampaignName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `Copy of ${trimmed}` : 'Copy of campaign';
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
        <ModalFooter>
          <Button
            variant="secondary"
            onPress={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onPress={handleCreate}
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'Create Campaign'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button
            onPress={handleCreate}
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'Create Campaign'}
          </Button>
        </ModalFooter>
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

function DuplicateCampaignModal({
  visible,
  sourceCampaign,
  onClose,
  onDuplicate,
  isLoading,
}: DuplicateCampaignModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [copySettings, setCopySettings] = useState(true);
  const [copyLeads, setCopyLeads] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible || !sourceCampaign) {
      return;
    }

    setName(buildDuplicateCampaignName(sourceCampaign.name));
    setCopySettings(true);
    setCopyLeads(false);
    setError('');
  }, [visible, sourceCampaign]);

  const handleClose = () => {
    setError('');
    onClose();
  };

  const handleDuplicate = async () => {
    if (!sourceCampaign) {
      setError('Campaign not found.');
      return;
    }
    if (!name.trim()) {
      setError('Campaign name is required');
      return;
    }

    setError('');
    try {
      await onDuplicate({
        name: name.trim(),
        copySettings,
        copyLeads,
      });
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate campaign');
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Duplicate Campaign"
      description={sourceCampaign ? `Create a new draft from ${sourceCampaign.name}.` : 'Create a new draft from an existing campaign.'}
      maxWidth="md"
      footer={
        <ModalFooter>
          <Button
            variant="secondary"
            onPress={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onPress={handleDuplicate}
            disabled={isLoading || !sourceCampaign}
          >
            {isLoading ? 'Duplicating...' : 'Duplicate'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button
            onPress={handleDuplicate}
            disabled={isLoading || !sourceCampaign}
          >
            {isLoading ? 'Duplicating...' : 'Duplicate'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="gap-4">
        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">New Campaign Name</Text>
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

        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-sm font-instrument-medium text-gray-300">Copy Campaign Settings</Text>
            <Text className="text-gray-400 font-instrument text-sm mt-1">
              Includes flow, schedule, mailboxes, cadence, webhooks, and tags.
            </Text>
          </View>
          <Toggle value={copySettings} onValueChange={setCopySettings} disabled={isLoading} />
        </View>

        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-sm font-instrument-medium text-gray-300">Copy Campaign Leads</Text>
            <Text className="text-gray-400 font-instrument text-sm mt-1">
              Copies people into the new draft without copying enrollments, jobs, or stats.
            </Text>
          </View>
          <Toggle value={copyLeads} onValueChange={setCopyLeads} disabled={isLoading} />
        </View>

        {error ? (
          <View className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
            <Text className="text-red-400 text-center font-instrument-medium text-sm">
              {error}
            </Text>
          </View>
        ) : null}
      </View>
    </BaseModal>
  );
}

interface CampaignCardProps {
  campaign: CampaignListSummary;
  tags: CampaignTag[];
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (campaign: CampaignListSummary) => void;
  onManageTags: (campaignId: string) => void;
  isDeleting: boolean;
}

function CampaignCard({ campaign, tags, onDelete, onDuplicate, onManageTags, isDeleting }: CampaignCardProps) {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSmartleadModal, setShowSmartleadModal] = useState(false);
  const isMobileLayout = screenWidth < LAYOUT_BREAKPOINT;
  const isDraft = campaign.status === 'draft';
  const draftHasFlow = campaign.hasFlow;
  const isSmartlead = isSmartleadCampaign(campaign);
  const smartleadBadge = isSmartlead ? <SmartleadBadge /> : null;

  const sentCount = campaign.sentCount;
  const repliedCount = campaign.repliedCount;
  const positiveReplyCount = campaign.positiveReplyCount;
  const bounceCount = campaign.bounceCount;
  const enrollmentCount = campaign.enrollmentCount;
  const contactedCount = campaign.contactedEnrollmentCount;
  const terminalCount = campaign.terminalEnrollmentCount;
  // Use max(contacted, terminal) for "reached" so enrollments that are terminal without
  // a sent email (e.g. stopped before first send) still count toward completion.
  const reachedCount = Math.max(contactedCount, terminalCount);
  const completionValue = reachedCount + terminalCount;
  const completionTotal = enrollmentCount > 0 ? enrollmentCount * 2 : 1;

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

  const handleDuplicate = () => {
    if (isSmartlead) { setShowSmartleadModal(true); return; }
    onDuplicate(campaign);
  };

  const handleEditFlow = () => {
    if (isSmartlead) { setShowSmartleadModal(true); return; }
    router.push({ pathname: '/builder', params: { campaignId: campaign.id } });
  };

  const overflowItems = useMemo(() => {
    const items = [];
    if (isDraft) {
      items.push({
        key: 'mission-control',
        label: 'Mission Control',
        onPress: handleContinueSetup,
        icon: RocketLaunchIcon,
      });
    }
    items.push(
      {
        key: 'manage-tags',
        label: 'Manage tags',
        onPress: () => onManageTags(campaign.id),
        icon: TagIcon,
      },
      {
        key: 'edit-flow',
        label: 'Edit flow',
        onPress: handleEditFlow,
        icon: PencilIcon,
      },
      {
        key: 'duplicate',
        label: 'Duplicate',
        onPress: handleDuplicate,
        icon: DocumentDuplicateIcon,
      },
      {
        key: 'delete',
        label: 'Delete',
        onPress: () => setShowDeleteModal(true),
        icon: TrashIcon,
        tone: 'destructive' as const,
      },
    );
    return items;
  }, [campaign, handleContinueSetup, handleDuplicate, handleEditFlow, isDraft, onManageTags]);

  const visibleOverflowItems = isSmartlead
    ? overflowItems.filter((item) => item.key !== 'mission-control')
    : overflowItems;

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
          {smartleadBadge}
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
          Created {formatDate(campaign.createdAt)}
        </Text>
        {tags.length > 0 ? (
          <View className="mt-2">
            <TagChipRow tags={tags} maxVisible={4} />
          </View>
        ) : null}
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
      {isSmartlead ? (
        <Tooltip content={<Text className="text-gray-300 font-instrument text-xs">Only the stats dashboard is available for Smartlead campaigns.</Text>}>
          <View className="opacity-50">
            <RowOverflowMenu
              items={visibleOverflowItems}
              disabled={isDeleting}
              menuMinWidth={184}
              triggerIcon={EllipsisHorizontalIcon}
              triggerAccessibilityLabel="Campaign actions"
              horizontalAlign="end"
              sheetTitle={campaign.name}
            />
          </View>
        </Tooltip>
      ) : (
        <RowOverflowMenu
          items={visibleOverflowItems}
          disabled={isDeleting}
          menuMinWidth={184}
          triggerIcon={EllipsisHorizontalIcon}
          triggerAccessibilityLabel="Campaign actions"
          horizontalAlign="end"
          sheetTitle={campaign.name}
        />
      )}
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
                <View className="flex-row items-center gap-2 mb-1 pr-2">
                  <Text className="text-white font-instrument-semibold text-base flex-1" numberOfLines={2}>
                    {campaign.name}
                  </Text>
                  {smartleadBadge}
                </View>
                <Text className="text-gray-500 font-instrument text-xs">
                  Created {formatDate(campaign.createdAt)}
                </Text>
                {isDraft && (
                  <Text className="text-gray-400 font-instrument text-xs mt-1">
                    {draftHasFlow
                      ? 'Next: Configure schedule & mailboxes to start'
                      : 'Next: Build your flow'}
                  </Text>
                )}
                {tags.length > 0 ? (
                  <View className="mt-2">
                    <TagChipRow tags={tags} maxVisible={4} />
                  </View>
                ) : null}
              </View>
              <View className="shrink-0 ml-1">
                <RowOverflowMenu
                  items={visibleOverflowItems}
                  disabled={isDeleting}
                  menuMinWidth={184}
                  triggerIcon={EllipsisHorizontalIcon}
                  triggerAccessibilityLabel="Campaign actions"
                  horizontalAlign="end"
                  sheetTitle={campaign.name}
                />
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
          <View
            className="absolute"
            style={{ right: 16, top: 0, bottom: 0, justifyContent: 'center' }}
          >
            {toolsBlockDesktop}
          </View>
        </Card>
      <ConfirmDeleteModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete campaign?"
        itemName={campaign.name}
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
  const [campaigns, setCampaigns] = useState<CampaignListSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [duplicateSourceCampaign, setDuplicateSourceCampaign] = useState<CampaignListSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<CampaignListFilters>(EMPTY_CAMPAIGN_LIST_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [managingTagsCampaignId, setManagingTagsCampaignId] = useState<string | null>(null);
  const showSkeleton = useSmoothLoading(isLoading);
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;

  const campaignIds = useMemo(() => campaigns.map((c) => c.id), [campaigns]);
  const {
    accountCampaignTags,
    campaignTagsMap,
    handleTagCreated,
    handleAddTagToCampaign,
    handleRemoveTagFromCampaign,
    handleUpdateTag,
    handleDeleteTag,
  } = useCampaignTags(account?.id ?? null, campaignIds);

  const activeFilterCount = countActiveCampaignListFilters(appliedFilters);

  const filteredCampaigns = useMemo(
    () => filterCampaigns(campaigns, searchQuery, appliedFilters, campaignTagsMap),
    [campaigns, searchQuery, appliedFilters, campaignTagsMap],
  );

  const loadCampaigns = async () => {
    if (!account?.id) return;

    setIsLoading(true);
    setError('');
    try {
      const data = await getCampaignsListSummary(account.id);
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

  const handleDuplicateCampaign = async ({ name, copySettings, copyLeads }: DuplicateCampaignFormValues) => {
    if (!duplicateSourceCampaign) {
      throw new Error('Campaign not found');
    }
    if (!user?.id) {
      throw new Error('User not authenticated');
    }
    if (!account?.id) {
      throw new Error('No account selected');
    }

    setIsDuplicating(true);
    try {
      const newCampaign = await duplicateCampaign(duplicateSourceCampaign.id, {
        name,
        ownerId: user.id,
        accountId: account.id,
        copySettings,
        copyLeads,
      });
      await loadCampaigns();
      toast.success('Campaign duplicated');
      setDuplicateSourceCampaign(null);
      router.push({
        pathname: '/campaigns/[id]/mission-control',
        params: { id: newCampaign.id },
      });
    } finally {
      setIsDuplicating(false);
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

  const headerActions = isMobile ? (
    <View className="flex-row items-center gap-2">{newCampaignButtonMobile}</View>
  ) : (
    <View className="flex-row items-center gap-2">{newCampaignButton}</View>
  );

  return (
    <PageLayout>
      <PageHeader
        title="Campaigns"
        subtitle="Manage your marketing campaigns"
        primaryAction={headerActions}
      />
      {/* Error Message */}
      {error ? (
        <Alert
          variant="error"
          message={error}
          actionText="Try again"
          onAction={loadCampaigns}
          className="mb-4"
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
          <View className="flex-row items-center mb-4" style={{ minWidth: 0, gap: 10 }}>
            <View
              className="flex-1 flex-row items-center rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] px-3 py-2.5"
              style={{ borderWidth: 1, minWidth: 0 }}
            >
              <MagnifyingGlassIcon size={20} color="#6B7280" style={{ marginRight: 10 }} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search by campaign name"
                placeholderTextColor="#6B7280"
                className="flex-1 text-white font-instrument text-base py-0"
                style={{ minHeight: 24 }}
              />
            </View>
            <View className="relative" style={{ flexShrink: 0 }}>
              <IconButton
                icon={FunnelIcon}
                variant="secondary"
                size="sm"
                matchButtonPadding="sm"
                className="!h-11 !w-11 !bg-[#1A1A1A] !border-[#2A2A2A]"
                accessibilityLabel="Campaign filters"
                onPress={() => setFiltersOpen(true)}
              />
              {activeFilterCount > 0 ? (
                <View className="absolute -top-1 -right-1 min-w-[18px] min-h-[18px] px-1 items-center justify-center rounded-full bg-brand-orange border border-[#1A1A1A]">
                  <Text className="text-white font-instrument-semibold text-[10px] leading-none">
                    {activeFilterCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {filteredCampaigns.length === 0 ? (
            <EmptyState
              title="No campaigns match"
              description="Try adjusting your search or filters."
            />
          ) : (
            filteredCampaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                tags={campaignTagsMap[campaign.id] ?? []}
                onDelete={handleDeleteCampaign}
                onDuplicate={setDuplicateSourceCampaign}
                onManageTags={setManagingTagsCampaignId}
                isDeleting={deletingId === campaign.id || (isDuplicating && duplicateSourceCampaign?.id === campaign.id)}
              />
            ))
          )}
        </View>
      )}

      {account?.id && managingTagsCampaignId ? (
        <CampaignTagsManager
          accountId={account.id}
          campaignId={managingTagsCampaignId}
          visible={managingTagsCampaignId !== null}
          onClose={() => setManagingTagsCampaignId(null)}
          tags={campaignTagsMap[managingTagsCampaignId] ?? []}
          accountTags={accountCampaignTags}
          onTagCreated={handleTagCreated}
          onAddTag={handleAddTagToCampaign}
          onRemoveTag={handleRemoveTagFromCampaign}
          onUpdateTag={handleUpdateTag}
          onDeleteTag={handleDeleteTag}
        />
      ) : null}
      <CampaignListFiltersModal
        visible={filtersOpen}
        filters={appliedFilters}
        accountTags={accountCampaignTags}
        onApply={setAppliedFilters}
        onClear={() => setAppliedFilters({ ...EMPTY_CAMPAIGN_LIST_FILTERS })}
        onClose={() => setFiltersOpen(false)}
      />

      {/* Create Campaign Modal */}
      <CreateCampaignModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateCampaign}
        isLoading={isCreating}
      />
      <DuplicateCampaignModal
        visible={duplicateSourceCampaign !== null}
        sourceCampaign={duplicateSourceCampaign}
        onClose={() => {
          if (!isDuplicating) {
            setDuplicateSourceCampaign(null);
          }
        }}
        onDuplicate={handleDuplicateCampaign}
        isLoading={isDuplicating}
      />
    </PageLayout>
  );
}
