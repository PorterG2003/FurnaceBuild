import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircleIcon } from 'react-native-heroicons/outline';
import { PageLayout, Breadcrumb } from '@/components/ui/layout';
import { LoadingState, Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FlowDiagram } from '@/components/campaigns';
import { ScheduleModal } from '@/components/campaigns/ScheduleModal';
import { MailboxesModal } from '@/components/campaigns/MailboxesModal';
import {
  getCampaignById,
  getCampaignMailboxes,
  updateCampaign,
  backfillCampaignEnrollments,
  cancelUnsentCampaignJobs,
} from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import {
  hasFlowBuilt,
  getFlowNodeCount,
  summarizeSchedule,
  calculateEmailsPerMailboxPerDay,
  scheduleFromCampaign,
} from '@/lib/campaigns/utils';

export default function MissionControlPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [mailboxes, setMailboxes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showMailboxesModal, setShowMailboxesModal] = useState(false);

  const loadCampaign = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setIsLoading(true);
    try {
      const [data, mailboxList] = await Promise.all([
        getCampaignById(id),
        getCampaignMailboxes(id),
      ]);
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

  const nameSet = !!(campaign?.name?.trim());
  const flowBuilt = hasFlowBuilt(campaign);
  const flowNodeCount = getFlowNodeCount(campaign);
  const mailboxesAdded = mailboxes.length >= 1;
  const isDraft = campaign?.status === 'draft';
  const isRunning = campaign?.status === 'running';
  const isPaused = campaign?.status === 'paused';
  const canStart = isDraft && nameSet && flowBuilt && mailboxesAdded;

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

  const handlePause = async () => {
    if (!id) return;
    setIsPausing(true);
    try {
      await updateCampaign(id, { status: 'paused' });
      await cancelUnsentCampaignJobs(id, 'Campaign paused');
      await loadCampaign(true);
    } catch (err) {
      console.error('Error pausing campaign:', err);
    } finally {
      setIsPausing(false);
    }
  };

  const handleResume = async () => {
    if (!id) return;
    setIsStarting(true);
    try {
      await updateCampaign(id, { status: 'running' });
      await loadCampaign(true);
    } catch (err) {
      console.error('Error resuming campaign:', err);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    setIsStopping(true);
    try {
      await updateCampaign(id, { status: 'stopped' });
      await cancelUnsentCampaignJobs(id, 'Campaign stopped');
      await loadCampaign(true);
    } catch (err) {
      console.error('Error stopping campaign:', err);
    } finally {
      setIsStopping(false);
    }
  };

  const handleEditFlow = () => {
    if (id) router.push({ pathname: '/builder', params: { campaignId: id } });
  };

  const handleBack = () => {
    if (id) router.push({ pathname: '/campaigns/[id]', params: { id } });
  };

  const checklist = [
    { label: 'Flow', done: flowBuilt, summary: flowBuilt ? `${flowNodeCount} step${flowNodeCount !== 1 ? 's' : ''} configured` : 'No flow built' },
    { label: 'Schedule', done: true, summary: summarizeSchedule(campaign) },
    { label: 'Mailboxes', done: mailboxesAdded, summary: mailboxesAdded ? `${mailboxes.length} mailbox${mailboxes.length !== 1 ? 'es' : ''} assigned` : 'No mailboxes assigned' },
  ];

  return (
    <PageLayout scrollable={false} contentPadding={0}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#121212',
          borderBottomWidth: 1,
          borderBottomColor: '#2A2A2A',
          zIndex: 10,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 24,
            paddingVertical: 16,
          }}
        >
          <Breadcrumb
            items={[
              { label: 'Campaigns', href: '/campaigns' },
              {
                label: isLoading ? 'Loading...' : (campaign?.name || 'Campaign'),
                href: id ? `/campaigns/${id}` : undefined,
              },
              { label: 'Mission Control' },
            ]}
          />
          <Pressable
            onPress={handleBack}
            className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
          >
            <Text className="text-white font-instrument-medium text-sm">Back</Text>
          </Pressable>
        </View>

        {/* Status bar for running/paused/stopped campaigns */}
        {!isLoading && !loadError && (isRunning || isPaused || campaign?.status === 'stopped') && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 24,
              paddingBottom: 16,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {(isRunning || isPaused) && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: isRunning ? '#F3440D' : '#F59E0B',
                  }}
                />
              )}
              <Text className="text-gray-400 font-instrument text-sm">
                {isRunning && 'Campaign is running'}
                {isPaused && 'Campaign is paused'}
                {campaign?.status === 'stopped' && 'This campaign has been stopped'}
              </Text>
            </View>
            {isRunning && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={handlePause}
                  disabled={isPausing}
                  style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.5)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}
                >
                  <Text className="text-amber-400 font-instrument-medium text-sm">
                    {isPausing ? 'Pausing...' : 'Pause'}
                  </Text>
                </Pressable>
                <Button onPress={handleStop} disabled={isStopping} variant="secondary">
                  {isStopping ? 'Stopping...' : 'Stop'}
                </Button>
              </View>
            )}
            {isPaused && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button onPress={handleResume} disabled={isStarting}>
                  {isStarting ? 'Resuming...' : 'Resume'}
                </Button>
                <Button onPress={handleStop} disabled={isStopping} variant="secondary">
                  {isStopping ? 'Stopping...' : 'Stop'}
                </Button>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        <LoadingState message="Loading mission control..." />
      ) : loadError ? (
        <View style={{ padding: 24 }}>
          <Alert variant="error" message={loadError} actionText="Retry" onAction={loadCampaign} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Flow Card (full-width). Height scales with node count so the full flow fits. */}
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
            <View style={{ margin: 12, marginTop: 16, borderRadius: 8, overflow: 'hidden', pointerEvents: 'none' }}>
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

          {/* Schedule + Mailboxes (side-by-side, same height) */}
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
            {/* Schedule Card */}
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

            {/* Mailboxes Card */}
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

          {/* Launch Readiness Section */}
          {isDraft && (
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
          )}
        </ScrollView>
      )}

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
    </PageLayout>
  );
}
