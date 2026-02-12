import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PageLayout, Breadcrumb } from '@/components/ui/layout';
import { LoadingState, Alert } from '@/components/ui/feedback';
import { ProgressDial } from '@/components/ui/progress-dial';
import { FlowDiagram } from '@/lib/test/campaign-flow/components/FlowDiagram';
import { LeadsTable, type Lead } from '@/lib/test/campaign-flow/components/LeadsTable';
import { ScheduleTab } from '@/lib/test/campaign-flow/components/ScheduleTab';
import { Tabs, type Tab } from '@/lib/test/campaign-flow/components/Tabs';
import { isWithinSchedule } from '@/lib/test/campaign-flow/utils';
import { getCampaignById, getCampaignMailboxes } from '@/lib/supabase/services/campaigns';
import { supabase } from '@/lib/supabase/client';
import type { Campaign } from '@/lib/supabase/types';
import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { ArrowPathIcon } from 'react-native-heroicons/outline';

const tabs: Tab[] = [
  { id: 'details', label: 'Details' },
  { id: 'leads', label: 'Leads' },
  { id: 'schedule', label: 'Schedule' },
];

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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('details');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadCampaign = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setIsLoading(true);
    setLoadError(null);
    try {
      const campaignData = await getCampaignById(id);
      if (!campaignData) {
        setLoadError('Campaign not found');
        return;
      }
      setCampaign(campaignData);

      const mailboxes = await getCampaignMailboxes(id);
      setMailboxCount(mailboxes?.length ?? 0);

      const { count: leadsCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', id);
      const totalLeads = leadsCount ?? 0;
      setLeadCount(totalLeads);

      const { count: enrollmentsCount } = await supabase
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', id);
      setEnrollmentCount(enrollmentsCount ?? 0);

      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('enrollments')
        .select('state, lead_id, current_node_id')
        .eq('campaign_id', id);

      if (!enrollmentsError && enrollments) {
        const completed = enrollments.filter((e: any) => e.state === 'completed').length;
        const inProgress = enrollments.filter((e: any) => e.state === 'active').length;
        const started = enrollments.length;
        const notStarted = Math.max(0, totalLeads - started);
        setLeadsCompleted(completed);
        setLeadsInProgress(inProgress);
        setLeadsNotStarted(notStarted);
      }

      setLeadsLoading(true);
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('id, email, name, created_at')
        .eq('campaign_id', id)
        .order('created_at', { ascending: false });

      if (!leadsError && leadsData) {
        const enrollmentMap = new Map<string, { state: 'active' | 'completed' | null; current_node_id: string | null }>();
        if (enrollments) {
          enrollments.forEach((enrollment: any) => {
            enrollmentMap.set(enrollment.lead_id, {
              state: enrollment.state as 'active' | 'completed' | null,
              current_node_id: enrollment.current_node_id,
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
            created_at: lead.created_at,
          };
        });
        setLeads(leadsWithEnrollment);
      }
    } catch (err) {
      console.error('Error loading campaign:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setLeadsLoading(false);
      if (!silent) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

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
    if (id) router.push({ pathname: '/builder', params: { campaignId: id } });
  };

  const handleOpenSetup = () => {
    if (id) router.push({ pathname: '/campaigns/[id]/setup', params: { id } });
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
          <Pressable
            onPress={handleOpenSetup}
            className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
          >
            <Text className="text-white font-instrument-medium text-sm">Setup</Text>
          </Pressable>
          <Pressable
            onPress={handleEditFlow}
            className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
          >
            <Text className="text-white font-instrument-medium text-sm">Edit flow</Text>
          </Pressable>
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
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
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

                      <View style={{ flex: 1, gap: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text className="text-gray-400 font-instrument text-xs">Mailboxes</Text>
                          <Text className="text-white font-instrument-semibold text-sm">{mailboxCount}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text className="text-gray-400 font-instrument text-xs">Leads</Text>
                          <Text className="text-white font-instrument-semibold text-sm">{leadCount}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text className="text-gray-400 font-instrument text-xs">Total Enrollments</Text>
                          <Text className="text-white font-instrument-semibold text-sm">{enrollmentCount}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={{ paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A2A2A' }}>
                      <Text className="text-gray-400 font-instrument text-xs mb-4 text-center">Lead Progress</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: 16 }}>
                        <ProgressDial
                          value={leadsNotStarted}
                          total={leadCount}
                          label="Not Started"
                          color="#6b7280"
                          size={90}
                        />
                        <ProgressDial
                          value={leadsInProgress}
                          total={leadCount}
                          label="In Progress"
                          color="#3b82f6"
                          size={90}
                        />
                        <ProgressDial
                          value={leadsCompleted}
                          total={leadCount}
                          label="Completed"
                          color="#10b981"
                          size={90}
                        />
                      </View>
                    </View>
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
    </PageLayout>
  );
}
