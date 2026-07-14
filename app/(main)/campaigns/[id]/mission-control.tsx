import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircleIcon } from 'react-native-heroicons/outline';
import { PageLayout, DetailPageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, usePageSkeleton } from '@/components/ui/feedback';
import { MissionControlSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { FlowDiagram, CampaignStatusMenu } from '@/components/campaigns';
import { useCampaignStatusActions } from '@/lib/campaigns/useCampaignStatusActions';
import { CampaignWebhookOverrideModal } from '@/components/campaigns/CampaignWebhookOverrideModal';
import { ScheduleModal } from '@/components/campaigns/ScheduleModal';
import { MailboxesModal } from '@/components/campaigns/MailboxesModal';
import {
  getCampaignById,
  getCampaignMailboxes,
  updateCampaign,
  backfillCampaignEnrollments,
} from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import {
  hasFlowBuilt,
  getFlowNodeCount,
  summarizeSchedule,
  calculateEmailsPerMailboxPerDay,
  scheduleFromCampaign,
  isSmartleadCampaign,
} from '@/lib/campaigns/utils';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';
export default function MissionControlPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [mailboxes, setMailboxes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showMailboxesModal, setShowMailboxesModal] = useState(false);
  const [showWebhookOverrideModal, setShowWebhookOverrideModal] = useState(false);

  const loadCampaign = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setIsLoading(true);
    try {
      const [data, mailboxList] = await Promise.all([
        getCampaignById(id),
        getCampaignMailboxes(id),
      ]);
      if (data?.deleted_at) {
        setCampaign(data);
        setMailboxes([]);
        setLoadError('This campaign has been deleted.');
        return;
      }
      setCampaign(data);
      setMailboxes(mailboxList || []);
      setLoadError(null);
    } catch (err) {
      console.error('Error loading campaign:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  const {
    isPausing,
    isStarting: isResuming,
    isStopping,
    handlePause,
    handleResume,
    handleStop,
  } = useCampaignStatusActions(id, loadCampaign);

  const isSmartlead = isSmartleadCampaign(campaign);

  const nameSet = !!(campaign?.name?.trim());
  const flowBuilt = hasFlowBuilt(campaign);
  const flowNodeCount = getFlowNodeCount(campaign);
  const mailboxesAdded = mailboxes.length >= 1;
  const isDraft = campaign?.status === 'draft';
  const isRunning = campaign?.status === 'running';
  const isPaused = campaign?.status === 'paused';
  const canStart = isDraft && nameSet && flowBuilt && mailboxesAdded;
  const { showPlaceholder } = usePageSkeleton(isLoading);

  const schedule = campaign ? scheduleFromCampaign(campaign) : null;
  const intervalMinutes = Math.floor((campaign?.sending_interval_seconds ?? 300) / 60);
  const throughputText = calculateEmailsPerMailboxPerDay(schedule, intervalMinutes);

  const flowData = useMemo(() => {
    if (!campaign?.flow_data) return null;
    try {
      const fd = typeof campaign.flow_data === 'string'
        ? JSON.parse(campaign.flow_data)
        : campaign.flow_data;
      if (fd && Array.isArray(fd.nodes)) return fd;
    } catch { /* ignore */ }
    return null;
  }, [campaign?.flow_data]);

  const mailboxIds = useMemo(() => mailboxes.map((m: any) => m.id), [mailboxes]);

  const handleStartCampaign = async () => {
    if (!id || !canStart) return;
    setIsStarting(true);
    try {
      await backfillCampaignEnrollments(id);
      await updateCampaign(id, { status: 'running' });
      await loadCampaign(true);
    } catch (err) {
      console.error('Error starting campaign:', err);
    } finally {
      setIsStarting(false);
    }
  };

  const handleEditFlow = () => {
    if (id) router.push({ pathname: '/builder', params: { campaignId: id } });
  };

  const checklist = [
    { label: 'Flow', done: flowBuilt, summary: flowBuilt ? `${flowNodeCount} step${flowNodeCount !== 1 ? 's' : ''} configured` : 'No flow built' },
    { label: 'Schedule', done: true, summary: summarizeSchedule(campaign) },
    { label: 'Mailboxes', done: mailboxesAdded, summary: mailboxesAdded ? `${mailboxes.length} mailbox${mailboxes.length !== 1 ? 'es' : ''} assigned` : 'No mailboxes assigned' },
  ];

  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  const isStopped = campaign?.status === 'stopped';
  const showStatusMenu = !isLoading && !loadError && (isRunning || isPaused || isStopped);
  const statusMenuProps = {
    status: (isRunning ? 'running' : isPaused ? 'paused' : 'stopped') as 'running' | 'paused' | 'stopped',
    campaignName: campaign?.name ?? undefined,
    isPausing,
    isStarting: isResuming,
    isStopping,
    onPause: handlePause,
    onResume: handleResume,
    onStop: handleStop,
  };

  const showHeaderActions = !isLoading && !loadError && !!campaign;
  const headerActions = showHeaderActions ? (
    <View className="flex-row gap-2 items-center">
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setShowWebhookOverrideModal(true)}
      >
        Webhook override
      </Button>
      {showStatusMenu ? <CampaignStatusMenu {...statusMenuProps} /> : null}
    </View>
  ) : undefined;

  const missionControlHeader = (
    <DetailPageHeader
      breadcrumbItems={[
        { label: 'Campaigns', href: '/campaigns' },
        {
          label: campaign?.name || 'Campaign',
          href: id ? `/campaigns/${id}` : undefined,
        },
        { label: 'Mission Control' },
      ]}
      backHref={id ? `/campaigns/${id}` : '/campaigns'}
      title="Mission Control"
      actions={headerActions}
      mobileRightAction={headerActions}
    />
  );

  return (
    <PageLayout scrollable={false} contentPadding={0}>
      {!isMobile && missionControlHeader}

      {/* Content */}
      {showPlaceholder ? (
        <>
          {isMobile && missionControlHeader}
          <MissionControlSkeleton />
        </>
      ) : loadError ? (
        <>
          {isMobile && missionControlHeader}
          <View style={{ padding: 24 }}>
            <Alert variant="error" message={loadError} actionText="Retry" onAction={loadCampaign} />
          </View>
        </>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {isMobile && missionControlHeader}
          {/* Flow Card (full-width). Height scales with node count so the full flow fits. */}
          <View>
          <Pressable
            onPress={handleEditFlow}
            className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl mb-6"
            style={{ overflow: 'hidden' }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 20,
                paddingBottom: 0,
                zIndex: 1,
                position: 'relative',
                pointerEvents: 'box-none',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text className="text-lg font-instrument-semibold text-white">Flow</Text>
                {flowBuilt && (
                  <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: '#10b98120' }}>
                    <Text className="text-xs font-instrument-semibold" style={{ color: '#10b981' }}>
                      {flowNodeCount} step{flowNodeCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                )}
              </View>
              <Button
                onPress={handleEditFlow}
                size="sm"
                variant={flowBuilt ? 'secondary' : 'default'}
              >
                {flowBuilt ? 'Edit flow' : 'Build flow'}
              </Button>
            </View>
            <View style={{ margin: 12, marginTop: 16, pointerEvents: 'none' }}>
              {flowData?.nodes && flowData.nodes.length > 0 ? (
                <FlowDiagram
                  nodes={flowData.nodes}
                  edges={flowData.edges || []}
                  height={Math.min(420, Math.max(260, 140 + flowData.nodes.length * 72))}
                />
              ) : (
                <View
                  style={{
                    height: 200,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#2A2A2A',
                    borderStyle: 'dashed',
                    borderRadius: 8,
                  }}
                >
                  <Text className="text-gray-500 font-instrument text-4xl mb-2" style={{ opacity: 0.6 }}>∿</Text>
                  <Text className="text-gray-400 font-instrument-medium text-sm">No flow yet</Text>
                  <Text className="text-gray-500 font-instrument text-xs mt-1">Click "Build flow" to get started</Text>
                </View>
              )}
            </View>
          </Pressable>
          </View>

          {/* Schedule + Mailboxes (side-by-side, same height) */}
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
            {/* Schedule Card */}
            <View style={{ flex: 1 }}>
            <Pressable
              onPress={() => setShowScheduleModal(true)}
              style={{ flex: 1 }}
            >
              <View
                className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5"
                style={{ height: 200, justifyContent: 'space-between' }}
              >
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Text className="text-lg font-instrument-semibold text-white">Schedule</Text>
                    <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: '#10b98120' }}>
                      <Text className="text-xs font-instrument-semibold" style={{ color: '#10b981' }}>
                        Configured
                      </Text>
                    </View>
                  </View>
                  <Text className="text-gray-300 font-instrument text-sm mb-2">
                    {summarizeSchedule(campaign)}
                  </Text>
                  <Text className="text-gray-400 font-instrument text-sm font-instrument-medium">
                    {throughputText}
                  </Text>
                </View>
                <Button size="sm" variant="secondary" onPress={() => setShowScheduleModal(true)}>
                  Edit schedule
                </Button>
              </View>
            </Pressable>
            </View>

            {/* Mailboxes Card */}
            <View style={{ flex: 1 }}>
            <Pressable
              onPress={() => setShowMailboxesModal(true)}
              style={{ flex: 1 }}
            >
              <View
                className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5"
                style={{ height: 200, justifyContent: 'space-between' }}
              >
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Text className="text-lg font-instrument-semibold text-white">Mailboxes</Text>
                    {mailboxesAdded ? (
                      <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: '#10b98120' }}>
                        <Text className="text-xs font-instrument-semibold" style={{ color: '#10b981' }}>
                          {mailboxes.length} assigned
                        </Text>
                      </View>
                    ) : (
                      <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: '#6b728020' }}>
                        <Text className="text-xs font-instrument-semibold" style={{ color: '#6b7280' }}>
                          None
                        </Text>
                      </View>
                    )}
                  </View>
                  {!mailboxesAdded && (
                    <Text className="text-gray-500 font-instrument text-sm">
                      No mailboxes assigned yet
                    </Text>
                  )}
                </View>
                <Button size="sm" variant="secondary" onPress={() => setShowMailboxesModal(true)}>
                  {mailboxesAdded ? 'Edit mailboxes' : 'Add mailboxes'}
                </Button>
              </View>
            </Pressable>
            </View>
          </View>

          {/* Launch card (drafts only) */}
          {isDraft ? (
            <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
              <Text className="text-lg font-instrument-semibold text-white mb-4">Ready to launch</Text>
              <View style={{ gap: 12, marginBottom: 20 }}>
                {checklist.map((item) => (
                  <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        borderWidth: 2,
                        borderColor: item.done ? '#10b981' : '#4B5563',
                        backgroundColor: item.done ? '#10b981' : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {item.done && <CheckCircleIcon size={14} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text className="text-white font-instrument-medium text-sm">{item.label}</Text>
                      <Text className="text-gray-500 font-instrument text-xs">{item.summary}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {!canStart && (
                <Text className="text-gray-500 font-instrument text-xs mb-3">
                  {!flowBuilt ? 'Build your flow to launch' : !mailboxesAdded ? 'Add at least one mailbox to launch' : ''}
                </Text>
              )}
              <Button onPress={handleStartCampaign} disabled={!canStart || isStarting}>
                {isStarting ? 'Launching...' : 'Launch campaign'}
              </Button>
            </View>
          ) : null}
        </ScrollView>
      )}

      <SmartleadRestrictedModal
        visible={!isLoading && isSmartlead}
        onClose={() => {}}
        campaignId={id ?? null}
        isOnStatsPage={false}
      />

      {/* Modals */}
      <ScheduleModal
        visible={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSaved={() => loadCampaign(true)}
        campaign={campaign}
        campaignId={id || ''}
      />
      <MailboxesModal
        visible={showMailboxesModal}
        onClose={() => setShowMailboxesModal(false)}
        onSaved={() => loadCampaign(true)}
        campaignId={id || ''}
        accountId={campaign?.account_id ?? null}
        currentMailboxIds={mailboxIds}
      />
      <CampaignWebhookOverrideModal
        visible={showWebhookOverrideModal}
        onClose={() => setShowWebhookOverrideModal(false)}
        onSaved={() => loadCampaign(true)}
        campaign={campaign}
      />
    </PageLayout>
  );
}
