import { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, ScrollView, Pressable, TextInput } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PageLayout } from '@/components/ui/layout';
import { ProgressDial } from '@/components/ui/progress-dial';
import { FlowDiagram } from '@/lib/test/campaign-flow/components/FlowDiagram';
import { LeadsTable, type Lead } from '@/lib/test/campaign-flow/components/LeadsTable';
import { ScheduleTab } from '@/lib/test/campaign-flow/components/ScheduleTab';
import { Tabs, type Tab } from '@/lib/test/campaign-flow/components/Tabs';
import { isWithinSchedule } from '@/lib/test/campaign-flow/utils';
import { getCampaignById, updateCampaign } from '@/lib/supabase/services/campaigns';
import { getCampaignMailboxes } from '@/lib/supabase/services/campaigns';
import { supabase } from '@/lib/supabase/client';
import type { Campaign } from '@/lib/supabase/types';
import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { PencilIcon, CheckIcon, XMarkIcon, ArrowPathIcon } from 'react-native-heroicons/outline';

export default function TestCampaignViewPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mailboxCount, setMailboxCount] = useState<number>(0);
  const [leadCount, setLeadCount] = useState<number>(0);
  const [enrollmentCount, setEnrollmentCount] = useState<number>(0);
  const [leadsStarted, setLeadsStarted] = useState<number>(0);
  const [leadsCompleted, setLeadsCompleted] = useState<number>(0);
  const [leadsInProgress, setLeadsInProgress] = useState<number>(0);
  const [leadsNotStarted, setLeadsNotStarted] = useState<number>(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('details');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs: Tab[] = [
    { id: 'details', label: 'Details' },
    { id: 'leads', label: 'Leads' },
    { id: 'schedule', label: 'Schedule' },
  ];

  const loadCampaignData = useCallback(async (isRefresh = false) => {
    if (!id) {
      setError('Campaign ID is required');
      setLoading(false);
      return;
    }

    try {
      // Only show full page loader on initial load, not on refresh
      if (!isRefresh) {
        setLoading(true);
      }
      setError(null);

      // Load campaign
      const campaignData = await getCampaignById(id);
      if (!campaignData) {
        setError('Campaign not found');
        setLoading(false);
        return;
      }
      setCampaign(campaignData);
      setEditedName(campaignData.name || '');

      // Load mailboxes
      const mailboxes = await getCampaignMailboxes(id);
      setMailboxCount(mailboxes.length);

      // Load leads count
      const { count: leadsCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', id)
        .like('email', '%@furnace.test');

      setLeadCount(leadsCount || 0);

      // Load enrollments count and progress stats
      const { count: enrollmentsCount } = await supabase
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', id);

      setEnrollmentCount(enrollmentsCount || 0);

      // Load enrollment progress stats
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('enrollments')
        .select('state, lead_id, current_node_id')
        .eq('campaign_id', id);

      if (!enrollmentsError && enrollments && leadsCount !== null) {
        const started = enrollments.length; // All enrollments are "started"
        const completed = enrollments.filter(e => e.state === 'completed').length;
        const inProgress = enrollments.filter(e => e.state === 'active').length;
        const notStarted = Math.max(0, leadsCount - started); // Leads without enrollments

        setLeadsStarted(started);
        setLeadsCompleted(completed);
        setLeadsInProgress(inProgress);
        setLeadsNotStarted(notStarted);
      }

      // Load leads with enrollment data
      setLeadsLoading(true);
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('id, email, name, created_at')
        .eq('campaign_id', id)
        .like('email', '%@furnace.test')
        .order('created_at', { ascending: false });

      if (!leadsError && leadsData) {
        // Create a map of lead_id to enrollment state
        const enrollmentMap = new Map<string, { state: 'active' | 'completed' | null; current_node_id: string | null }>();
        if (enrollments) {
          enrollments.forEach((enrollment: any) => {
            enrollmentMap.set(enrollment.lead_id, {
              state: enrollment.state as 'active' | 'completed' | null,
              current_node_id: enrollment.current_node_id,
            });
          });
        }

        // Combine leads with enrollment data
        const leadsWithEnrollment: Lead[] = leadsData.map((lead) => {
          const enrollment = enrollmentMap.get(lead.id);
          return {
            id: lead.id,
            email: lead.email || '',
            name: lead.name,
            enrollment_state: enrollment?.state || null,
            enrollment_current_node_id: enrollment?.current_node_id || null,
            created_at: lead.created_at,
          };
        });

        setLeads(leadsWithEnrollment);
      }
      setLeadsLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaignData();
  }, [loadCampaignData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCampaignData(true); // Pass true to indicate this is a refresh
      setRefreshKey(prev => prev + 1); // Increment refresh key to trigger child component refreshes
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <PageLayout>
        <View className="flex-1 justify-center items-center py-12">
          <ActivityIndicator size="large" color="#f85102" />
          <Text className="mt-4 text-gray-400 font-instrument text-sm">Loading campaign...</Text>
        </View>
      </PageLayout>
    );
  }

  if (error || !campaign) {
    return (
      <PageLayout>
        <View className="mb-6">
          <Pressable
            onPress={() => router.push('/test/campaigns' as any)}
            className="mb-4 px-4 py-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg self-start"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text className="text-gray-300 font-instrument text-sm">← Back</Text>
          </Pressable>
        </View>
        <View className="bg-red-900/20 border border-red-800 rounded-xl p-6">
          <Text className="text-red-400 font-instrument text-sm">
            Error: {error || 'Campaign not found'}
          </Text>
        </View>
      </PageLayout>
    );
  }

  const schedule = (campaign.schedule as any) || null;
  const flowData = campaign.flow_data as any;
  
  // Check if current time is within schedule
  const scheduleActive = schedule ? isWithinSchedule(schedule) : true; // Default to active if no schedule
  
  // Get current time in schedule timezone (24-hour format)
  const currentTimeInTimezone = schedule
    ? format(utcToZonedTime(new Date(), schedule.timezone), 'HH:mm')
    : null;

  return (
    <PageLayout>
      {/* Header */}
      <View className="mb-6">
        <View className="flex-row items-center gap-2 mb-4">
          <Pressable
            onPress={() => router.push('/test/campaigns' as any)}
            className="px-4 py-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text className="text-gray-300 font-instrument text-sm">← Back</Text>
          </Pressable>
          <Pressable
            onPress={handleRefresh}
            disabled={refreshing || loading}
            className="px-4 py-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg flex-row items-center gap-2"
            style={{ opacity: refreshing || loading ? 0.5 : 1 }}
            accessibilityRole="button"
            accessibilityLabel="Refresh campaign data"
          >
            <ArrowPathIcon 
              size={16} 
              color="#9ca3af" 
              style={{ transform: [{ rotate: refreshing ? '180deg' : '0deg' }] }}
            />
            <Text className="text-gray-300 font-instrument text-sm">
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Text>
          </Pressable>
        </View>
        
        {/* Campaign Name Editor */}
        {isEditingName ? (
          <View className="flex-row items-center gap-2 mb-2">
            <TextInput
              value={editedName}
              onChangeText={setEditedName}
              placeholder="Campaign name"
              placeholderTextColor="#6b7280"
              className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-white font-instrument text-2xl font-instrument-semibold"
              autoFocus
              editable={!savingName}
            />
            <Pressable
              onPress={async () => {
                if (!campaign || !editedName.trim()) return;
                try {
                  setSavingName(true);
                  const updated = await updateCampaign(campaign.id, { name: editedName.trim() });
                  setCampaign(updated);
                  setIsEditingName(false);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to update campaign name');
                } finally {
                  setSavingName(false);
                }
              }}
              disabled={savingName || !editedName.trim()}
              className="px-4 py-3 bg-brand-orange rounded-lg"
              style={{ backgroundColor: savingName || !editedName.trim() ? '#6b7280' : '#f85102' }}
              accessibilityRole="button"
              accessibilityLabel="Save name"
            >
              <CheckIcon size={20} color="#ffffff" />
            </Pressable>
            <Pressable
              onPress={() => {
                setEditedName(campaign?.name || '');
                setIsEditingName(false);
              }}
              disabled={savingName}
              className="px-4 py-3 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg"
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
            >
              <XMarkIcon size={20} color="#ffffff" />
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center gap-3 mb-2">
            <Text className="text-2xl font-instrument-semibold text-white flex-1">
              {campaign.name || 'Unnamed Campaign'}
            </Text>
            <Pressable
              onPress={() => {
                setEditedName(campaign?.name || '');
                setIsEditingName(true);
              }}
              className="px-3 py-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg"
              accessibilityRole="button"
              accessibilityLabel="Edit campaign name"
            >
              <PencilIcon size={18} color="#9ca3af" />
            </Pressable>
          </View>
        )}
        
        <Text className="text-gray-400 font-instrument text-sm">
          Test Campaign Overview
        </Text>
      </View>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <ScrollView>
        {/* Details Tab */}
        {activeTab === 'details' && (
          <>
            {/* Combined Details Card */}
            <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4">
              {/* Header with Status */}
              <View className="flex-row items-center justify-between mb-6">
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

              {/* Main Content Grid */}
              <View className="gap-6">
                {/* Top Row: Details and Statistics */}
                <View className="flex-row gap-6">
                  {/* Left: Campaign Details */}
                  <View className="flex-1 gap-3">
                    <View>
                      <Text className="text-gray-400 font-instrument text-xs mb-1">Created</Text>
                      <Text className="text-white font-instrument text-sm">
                        {format(new Date(campaign.created_at), 'MMM d, yyyy h:mm a')}
                      </Text>
                    </View>

                    {schedule && (
                      <View>
                        <Text className="text-gray-400 font-instrument text-xs mb-1">Schedule</Text>
                        <View className="flex-row items-center gap-2 mb-1">
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
                            ? `${schedule.start_hour.toString().padStart(2, '0')}:${(schedule.start_minute || 0).toString().padStart(2, '0')} - ${schedule.end_hour.toString().padStart(2, '0')}:${(schedule.end_minute || 0).toString().padStart(2, '0')}`
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

                    {campaign.jitter_percentage !== null && campaign.jitter_percentage !== undefined && (
                      <View>
                        <Text className="text-gray-400 font-instrument text-xs mb-1">Jitter</Text>
                        <Text className="text-white font-instrument text-sm">
                          {campaign.jitter_percentage}%
                        </Text>
                      </View>
                    )}

                    {flowData && flowData.nodes && (
                      <View>
                        <Text className="text-gray-400 font-instrument text-xs mb-1">Flow Nodes</Text>
                        <Text className="text-white font-instrument text-sm">
                          {flowData.nodes.filter((n: any) => n.type !== 'leadSource').length} node(s)
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Right: Statistics */}
                  <View className="flex-1 gap-3">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 font-instrument text-xs">Test Mailboxes</Text>
                      <Text className="text-white font-instrument-semibold text-sm">{mailboxCount}</Text>
                    </View>

                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 font-instrument text-xs">Test Leads</Text>
                      <Text className="text-white font-instrument-semibold text-sm">{leadCount}</Text>
                    </View>

                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 font-instrument text-xs">Total Enrollments</Text>
                      <Text className="text-white font-instrument-semibold text-sm">{enrollmentCount}</Text>
                    </View>
                  </View>
                </View>

                {/* Bottom Row: Progress Dials */}
                <View className="pt-4 border-t border-[#2A2A2A]">
                  <Text className="text-gray-400 font-instrument text-xs mb-4 text-center">Lead Progress</Text>
                  <View className="flex-row flex-wrap justify-around gap-4">
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

            {/* Flow Diagram Card */}
            {flowData && flowData.nodes && flowData.edges && (
              <View className="mb-4">
                <Text className="text-lg font-instrument-semibold text-white mb-4">Campaign Flow</Text>
                <FlowDiagram nodes={flowData.nodes} edges={flowData.edges} />
              </View>
            )}
          </>
        )}

        {/* Leads Tab */}
        {activeTab === 'leads' && (
          <View className="mb-4">
            <LeadsTable leads={leads} loading={leadsLoading} campaignId={id} />
          </View>
        )}

        {/* Schedule Tab */}
        {activeTab === 'schedule' && (
          <View className="mb-4">
            <ScheduleTab campaignId={id} refreshTrigger={refreshKey} />
          </View>
        )}
      </ScrollView>
    </PageLayout>
  );
}

