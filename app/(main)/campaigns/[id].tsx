import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PageLayout, Breadcrumb } from '@/components/ui/layout';
import { LoadingState, Alert } from '@/components/ui/feedback';
import { MultiSegmentDial } from '@/components/ui/multi-segment-dial';
import { FlowDiagram, LeadsTable, ScheduleTab, type Lead } from '@/components/campaigns';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { isWithinSchedule, isSmartleadCampaign } from '@/lib/campaigns/utils';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';
import { Tooltip } from '@/components/ui/Tooltip';
import { getCampaignById, getCampaignMailboxes, getCampaignStatsByDay, getCampaignStatsForCampaigns, type CampaignStatsByDay, type CampaignStats } from '@/lib/supabase/services/campaigns';
import { supabase } from '@/lib/supabase/client';
import { CampaignStatsChart } from '@/components/campaigns/CampaignStatsChart';
import type { Campaign } from '@/lib/supabase/types';
import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { ArrowPathIcon } from 'react-native-heroicons/outline';

const tabs: Tab[] = [
  { id: 'details', label: 'Details' },
  { id: 'leads', label: 'Leads' },
  { id: 'schedule', label: 'Schedule' },
];

function fillMissingStatsByDay(
  rows: CampaignStatsByDay[],
  startDate: string,
  endDate: string
): CampaignStatsByDay[] {
  const existingByDay = new Map(rows.map((item) => [item.date, item] as const));
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return rows;
  }

  const filled: CampaignStatsByDay[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const existing = existingByDay.get(date);
    filled.push(
      existing ?? {
        date,
        sent: 0,
        replied: 0,
        positiveReply: 0,
        bounce: 0,
      }
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return filled;
}

export default function CampaignPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mailboxCount, setMailboxCount] = useState(0);
  const [leadCount, setLeadCount] = useState(0);
  const [enrollmentCount, setEnrollmentCount] = useState(0);
  const [leadsNotStarted, setLeadsNotStarted] = useState(0);
  const [leadsInProgress, setLeadsInProgress] = useState(0);
  const [leadsCompleted, setLeadsCompleted] = useState(0);
  const [leadsStopped, setLeadsStopped] = useState(0);
  const [leadsPaused, setLeadsPaused] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('details');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [statsByDay, setStatsByDay] = useState<CampaignStatsByDay[]>([]);
  const [statsByDayLoading, setStatsByDayLoading] = useState(false);
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);
  const [showSmartleadRestrictedModal, setShowSmartleadRestrictedModal] = useState(false);

  const isSmartlead = isSmartleadCampaign(campaign);

  useEffect(() => {
    if (isSmartlead && activeTab !== 'details') {
      setActiveTab('details');
    }
  }, [isSmartlead]);

  const loadCampaign = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setIsLoading(true);
    setLoadError(null);
    try {
      const campaignData = await getCampaignById(id);
      if (!campaignData) {
        setLoadError('Campaign not found');
        setCampaignStats(null);
        return;
      }
      setCampaign(campaignData);

      const [mailboxesResult, statsResult] = await Promise.all([
        getCampaignMailboxes(id),
        getCampaignStatsForCampaigns([id]).then((m) => m[id] ?? null),
      ]);
      const mailboxes = mailboxesResult;
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'campaigns/[id].tsx:loadCampaign',message:'Detail page received stats',data:{id,statsResult:statsResult!=null?{sentCount:statsResult.sentCount,repliedCount:statsResult.repliedCount,enrollmentCount:statsResult.enrollmentCount,contactedEnrollmentCount:statsResult.contactedEnrollmentCount}:null},timestamp:Date.now(),hypothesisId:'B_C_D'})}).catch(()=>{});
      // #endregion
      setCampaignStats(statsResult);
      setMailboxCount(mailboxes?.length ?? 0);

      // Single enrollments query: derive count and state breakdown from same snapshot
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('enrollments')
        .select('state, lead_id, current_node_id, stopped_reason, stopped_error_message')
        .eq('campaign_id', id);

      const enrollmentCount = enrollments?.length ?? 0;
      setEnrollmentCount(enrollmentCount);

      if (!enrollmentsError && enrollments) {
        const completed = enrollments.filter((e: any) => e.state === 'completed').length;
        const inProgress = enrollments.filter((e: any) => e.state === 'active').length;
        const stopped = enrollments.filter((e: any) => e.state === 'stopped').length;
        const paused = enrollments.filter((e: any) => e.state === 'paused').length;
        setLeadsCompleted(completed);
        setLeadsInProgress(inProgress);
        setLeadsStopped(stopped);
        setLeadsPaused(paused);
      }

      // Single leads query: use same snapshot for lead count and leads list
      setLeadsLoading(true);
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('id, email, name, created_at')
        .eq('campaign_id', id)
        .order('created_at', { ascending: false });

      if (leadsError) {
        setLeadCount(0);
        setLeads([]);
        setLeadsNotStarted(0);
      } else if (leadsData) {
        const totalLeads = leadsData.length;
        setLeadCount(totalLeads);

        const notStarted = Math.max(0, totalLeads - enrollmentCount);
        setLeadsNotStarted(notStarted);

        type StoppedReason = 'replied' | 'bounced' | 'unsubscribed' | 'error';
        const enrollmentMap = new Map<
          string,
          {
            state: 'active' | 'completed' | 'stopped' | 'paused' | null;
            current_node_id: string | null;
            stopped_reason: StoppedReason | null;
            stopped_error_message: string | null;
          }
        >();
        if (enrollments) {
          enrollments.forEach((enrollment: any) => {
            enrollmentMap.set(enrollment.lead_id, {
              state: enrollment.state as 'active' | 'completed' | 'stopped' | 'paused' | null,
              current_node_id: enrollment.current_node_id,
              stopped_reason:
                enrollment.stopped_reason != null && ['replied', 'bounced', 'unsubscribed', 'error'].includes(enrollment.stopped_reason)
                  ? (enrollment.stopped_reason as StoppedReason)
                  : null,
              stopped_error_message: enrollment.stopped_error_message ?? null,
            });
          });
        }
        const leadsWithEnrollment: Lead[] = leadsData.map((lead: any) => {
          const enrollment = enrollmentMap.get(lead.id);
          return {
            id: lead.id,
            email: lead.email || '',
            name: lead.name,
            enrollment_state: enrollment?.state ?? null,
            enrollment_current_node_id: enrollment?.current_node_id ?? null,
            enrollment_stopped_reason: enrollment?.stopped_reason ?? null,
            enrollment_stopped_error_message: enrollment?.stopped_error_message ?? null,
            created_at: lead.created_at,
          };
        });
        setLeads(leadsWithEnrollment);
      }
    } catch (err) {
      console.error('Error loading campaign:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load campaign');
      setCampaignStats(null);
    } finally {
      setLeadsLoading(false);
      if (!silent) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  const loadStatsByDay = useCallback(async () => {
    if (!id || !campaign) return;
    setStatsByDayLoading(true);
    try {
      // For Smartlead campaigns, use smartlead_created_at so the range includes imported historical data.
      // Furnace campaign.created_at is when we migrated, which would exclude past stats.
      const startStr =
        campaign.source === 'smartlead' && campaign.smartlead_created_at
          ? campaign.smartlead_created_at.slice(0, 10)
          : campaign.created_at.slice(0, 10);
      const endStr = new Date().toISOString().slice(0, 10);
      const data = await getCampaignStatsByDay(id, startStr, endStr, campaign?.source ?? null);
      setStatsByDay(fillMissingStatsByDay(data, startStr, endStr));
    } catch (err) {
      console.error('Error loading campaign stats by day:', err);
      setStatsByDay([]);
    } finally {
      setStatsByDayLoading(false);
    }
  }, [id, campaign]);

  useEffect(() => {
    if (id && campaign && activeTab === 'details') loadStatsByDay();
  }, [id, campaign, activeTab, loadStatsByDay, refreshKey]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCampaign(true);
      setRefreshKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const handleEditFlow = () => {
    if (isSmartlead) { setShowSmartleadRestrictedModal(true); return; }
    if (id) router.push({ pathname: '/builder', params: { campaignId: id } });
  };

  const handleOpenMissionControl = () => {
    if (isSmartlead) { setShowSmartleadRestrictedModal(true); return; }
    if (id) router.push({ pathname: '/campaigns/[id]/mission-control', params: { id } });
  };

  const schedule = campaign ? (campaign.schedule as any) || null : null;
  const flowData = campaign ? (campaign.flow_data as any) : null;
  const scheduleActive = schedule ? isWithinSchedule(schedule) : true;
  const currentTimeInTimezone = schedule
    ? format(utcToZonedTime(new Date(), schedule.timezone), 'HH:mm')
    : null;

  return (
    <PageLayout scrollable={false} contentPadding={0}>
      <View
        style={{
          backgroundColor: '#121212',
          borderBottomWidth: 1,
          borderBottomColor: '#2A2A2A',
          paddingHorizontal: 24,
          paddingVertical: 16,
          zIndex: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Breadcrumb
          items={[
            { label: 'Campaigns', href: '/campaigns' },
            {
              label: isLoading ? 'Loading...' : campaign?.name || 'Campaign',
            },
          ]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={handleRefresh}
            disabled={refreshing || isLoading}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#3A3A3A',
              backgroundColor: '#2A2A2A',
              opacity: refreshing || isLoading ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ArrowPathIcon size={16} color="#9ca3af" style={{ transform: [{ rotate: refreshing ? '180deg' : '0deg' }] }} />
              <Text className="text-gray-300 font-instrument text-sm">
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </Text>
            </View>
          </Pressable>
          {isSmartlead ? (
            <Tooltip content={<Text className="text-gray-300 font-instrument text-xs">Only the stats dashboard is available for Smartlead campaigns.</Text>}>
              <Pressable
                onPress={handleOpenMissionControl}
                className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
                style={{ opacity: 0.5 }}
              >
                <Text className="text-white font-instrument-medium text-sm">Mission Control</Text>
              </Pressable>
            </Tooltip>
          ) : (
            <Pressable
              onPress={handleOpenMissionControl}
              className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
            >
              <Text className="text-white font-instrument-medium text-sm">Mission Control</Text>
            </Pressable>
          )}
          {isSmartlead ? (
            <Tooltip content={<Text className="text-gray-300 font-instrument text-xs">Only the stats dashboard is available for Smartlead campaigns.</Text>}>
              <Pressable
                onPress={handleEditFlow}
                className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
                style={{ opacity: 0.5 }}
              >
                <Text className="text-white font-instrument-medium text-sm">Edit flow</Text>
              </Pressable>
            </Tooltip>
          ) : (
            <Pressable
              onPress={handleEditFlow}
              className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
            >
              <Text className="text-white font-instrument-medium text-sm">Edit flow</Text>
            </Pressable>
          )}
        </View>
      </View>

      {isLoading ? (
        <LoadingState message="Loading campaign..." />
      ) : loadError ? (
        <View style={{ padding: 24 }}>
          <Alert variant="error" message={loadError} actionText="Retry" onAction={() => loadCampaign()} />
        </View>
      ) : campaign ? (
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16 }}>
          <Tabs tabs={isSmartlead ? [{ id: 'details', label: 'Details' }] : tabs} activeTab={activeTab} onTabChange={setActiveTab} />
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === 'details' && (
              <>
                <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4">
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                    <Text className="text-lg font-instrument-semibold text-white">Campaign Overview</Text>
                    <View
                      className="px-3 py-1 rounded-lg"
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

                  <View style={{ gap: 24 }}>
                    <View style={{ flexDirection: 'row', gap: 24 }}>
                      <View style={{ flex: 1, gap: 12 }}>
                        <View>
                          <Text className="text-gray-400 font-instrument text-xs mb-1">Created</Text>
                          <Text className="text-white font-instrument text-sm">
                            {format(new Date(campaign.created_at), 'MMM d, yyyy h:mm a')}
                          </Text>
                        </View>

                        {schedule && (
                          <View>
                            <Text className="text-gray-400 font-instrument text-xs mb-1">Schedule</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <View
                                className="px-2 py-0.5 rounded"
                                style={{
                                  backgroundColor: scheduleActive ? '#10b98120' : '#6b728020',
                                }}
                              >
                                <Text
                                  className="text-xs font-instrument-semibold"
                                  style={{
                                    color: scheduleActive ? '#10b981' : '#6b7280',
                                  }}
                                >
                                  {scheduleActive ? 'Active' : 'Inactive'}
                                </Text>
                              </View>
                              {currentTimeInTimezone && (
                                <Text className="text-gray-500 font-instrument text-xs">
                                  Current: {currentTimeInTimezone}
                                </Text>
                              )}
                            </View>
                            <Text className="text-white font-instrument text-sm">
                              {schedule.timezone && `${schedule.timezone} • `}
                              {schedule.start_hour !== undefined && schedule.end_hour !== undefined
                                ? `${String(schedule.start_hour).padStart(2, '0')}:${String(schedule.start_minute ?? 0).padStart(2, '0')} - ${String(schedule.end_hour).padStart(2, '0')}:${String(schedule.end_minute ?? 0).padStart(2, '0')}`
                                : '24/7'}
                              {schedule.days_of_week && schedule.days_of_week.length > 0 && (
                                <Text className="text-gray-400">
                                  {' • '}
                                  {schedule.days_of_week.length === 7
                                    ? 'Every day'
                                    : schedule.days_of_week.length === 5 &&
                                        schedule.days_of_week.every((d: number) => [1, 2, 3, 4, 5].includes(d))
                                      ? 'Weekdays'
                                      : `${schedule.days_of_week.length} day(s)`}
                                </Text>
                              )}
                            </Text>
                          </View>
                        )}

                        {campaign.jitter_percentage != null && (
                          <View>
                            <Text className="text-gray-400 font-instrument text-xs mb-1">Jitter</Text>
                            <Text className="text-white font-instrument text-sm">{campaign.jitter_percentage}%</Text>
                          </View>
                        )}

                        {flowData?.nodes && (
                          <View>
                            <Text className="text-gray-400 font-instrument text-xs mb-1">Flow Nodes</Text>
                            <Text className="text-white font-instrument text-sm">
                              {flowData.nodes.filter((n: any) => n.type !== 'leadSource').length} node(s)
                            </Text>
                          </View>
                        )}
                      </View>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text className="text-gray-400 font-instrument text-xs mb-3">Lead Progress</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 80, flexWrap: 'wrap' }}>
                          <MultiSegmentDial
                            segments={[
                              { value: leadsNotStarted, color: '#6b7280' },
                              { value: leadsInProgress, color: '#3b82f6' },
                              { value: leadsPaused, color: '#8b5cf6' },
                              { value: leadsCompleted, color: '#10b981' },
                              { value: leadsStopped, color: '#f59e0b' },
                            ]}
                            total={leadCount}
                            size={150}
                            strokeWidth={10}
                            centerValue={leadsCompleted + leadsStopped}
                            centerTotal={leadCount}
                            centerTopLabel="Completed"
                            centerBottomLabel="Total"
                          />
                          <View style={{ flex: 1, minWidth: 140 }}>
                            {leadCount === 0 ? (
                              <Text className="text-gray-500 font-instrument text-sm">No leads</Text>
                            ) : (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: 160 }}>
                                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#6b7280' }} />
                                    <Text className="text-gray-300 font-instrument text-sm">Not Started</Text>
                                  </View>
                                  <Text className="text-white font-instrument text-sm" style={{ width: 28, textAlign: 'right' }}>{leadsNotStarted}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: 160 }}>
                                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#3b82f6' }} />
                                    <Text className="text-gray-300 font-instrument text-sm">In Progress</Text>
                                  </View>
                                  <Text className="text-white font-instrument text-sm" style={{ width: 28, textAlign: 'right' }}>{leadsInProgress}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: 160 }}>
                                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#8b5cf6' }} />
                                    <Text className="text-gray-300 font-instrument text-sm">Paused</Text>
                                  </View>
                                  <Text className="text-white font-instrument text-sm" style={{ width: 28, textAlign: 'right' }}>{leadsPaused}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: 160 }}>
                                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#10b981' }} />
                                    <Text className="text-gray-300 font-instrument text-sm">Completed</Text>
                                  </View>
                                  <Text className="text-white font-instrument text-sm" style={{ width: 28, textAlign: 'right' }}>{leadsCompleted}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: 160 }}>
                                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#f59e0b' }} />
                                    <Text className="text-gray-300 font-instrument text-sm">Stopped</Text>
                                  </View>
                                  <Text className="text-white font-instrument text-sm" style={{ width: 28, textAlign: 'right' }}>{leadsStopped}</Text>
                                </View>
                              </>
                            )}
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>
                  <View style={{ borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingTop: 24, marginTop: 24 }}>
                    <View style={{ marginBottom: 16 }}>
                      <Text className="text-lg font-instrument-semibold text-white">Daily activity</Text>
                      {campaign?.source === 'smartlead' && (
                        <Text className="text-sm text-neutral-400 font-instrument mt-1">Imported from Smartlead</Text>
                      )}
                    </View>
                    <CampaignStatsChart data={statsByDay} loading={statsByDayLoading} embedded />
                  </View>
                  </View>

                {flowData?.nodes && flowData?.edges && (
                  <View style={{ marginBottom: 16 }}>
                    <Text className="text-lg font-instrument-semibold text-white mb-4">Campaign Flow</Text>
                    <FlowDiagram nodes={flowData.nodes} edges={flowData.edges} />
                  </View>
                )}
              </>
            )}

            {activeTab === 'leads' && (
              <View style={{ marginBottom: 16 }}>
                <LeadsTable leads={leads} loading={leadsLoading} campaignId={id!} />
              </View>
            )}

            {activeTab === 'schedule' && (
              <View style={{ marginBottom: 16 }}>
                <ScheduleTab campaignId={id!} refreshTrigger={refreshKey} />
              </View>
            )}
          </ScrollView>
        </View>
      ) : null}
      <SmartleadRestrictedModal
        visible={showSmartleadRestrictedModal}
        onClose={() => setShowSmartleadRestrictedModal(false)}
        campaignId={id ?? null}
        isOnStatsPage={true}
      />
    </PageLayout>
  );
}
