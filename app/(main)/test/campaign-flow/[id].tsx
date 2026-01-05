import { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PageLayout } from '@/components/ui/layout';
import { ProgressDial } from '@/components/ui/progress-dial';
import { getCampaignById } from '@/lib/supabase/services/campaigns';
import { getCampaignMailboxes } from '@/lib/supabase/services/campaigns';
import { supabase } from '@/lib/supabase/client';
import type { Campaign } from '@/lib/supabase/types';
import { format } from 'date-fns';

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

  useEffect(() => {
    if (!id) {
      setError('Campaign ID is required');
      setLoading(false);
      return;
    }

    const loadCampaignData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load campaign
        const campaignData = await getCampaignById(id);
        if (!campaignData) {
          setError('Campaign not found');
          setLoading(false);
          return;
        }
        setCampaign(campaignData);

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
          .select('state')
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
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadCampaignData();
  }, [id]);

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
            onPress={() => router.back()}
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

  return (
    <PageLayout>
      {/* Header */}
      <View className="mb-6">
        <Pressable
          onPress={() => router.back()}
          className="mb-4 px-4 py-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg self-start"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text className="text-gray-300 font-instrument text-sm">← Back</Text>
        </Pressable>
        <Text className="text-2xl font-instrument-semibold text-white mb-1">
          {campaign.name || 'Unnamed Campaign'}
        </Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Test Campaign Overview
        </Text>
      </View>

      <ScrollView>
        {/* Status Badge */}
        <View className="mb-6">
          <View
            className="self-start px-4 py-2 rounded-lg"
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
              className="text-sm font-instrument-semibold uppercase"
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

        {/* Campaign Info Card */}
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4">
          <Text className="text-lg font-instrument-semibold text-white mb-4">Campaign Details</Text>

          <View className="gap-4">
            <View>
              <Text className="text-gray-400 font-instrument text-xs mb-1">Created</Text>
              <Text className="text-white font-instrument text-sm">
                {format(new Date(campaign.created_at), 'MMM d, yyyy h:mm a')}
              </Text>
            </View>

            {schedule && (
              <View>
                <Text className="text-gray-400 font-instrument text-xs mb-1">Schedule</Text>
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
        </View>

        {/* Progress Card */}
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4">
          <Text className="text-lg font-instrument-semibold text-white mb-6">Progress</Text>

          <View className="flex-row flex-wrap justify-around gap-6">
            <ProgressDial
              value={leadsNotStarted}
              total={leadCount}
              label="Not Started"
              color="#6b7280"
              size={100}
            />
            <ProgressDial
              value={leadsInProgress}
              total={leadCount}
              label="In Progress"
              color="#3b82f6"
              size={100}
            />
            <ProgressDial
              value={leadsCompleted}
              total={leadCount}
              label="Completed"
              color="#10b981"
              size={100}
            />
          </View>
        </View>

        {/* Statistics Card */}
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4">
          <Text className="text-lg font-instrument-semibold text-white mb-4">Statistics</Text>

          <View className="gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-gray-400 font-instrument text-sm">Test Mailboxes</Text>
              <Text className="text-white font-instrument-semibold text-sm">{mailboxCount}</Text>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-gray-400 font-instrument text-sm">Test Leads</Text>
              <Text className="text-white font-instrument-semibold text-sm">{leadCount}</Text>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-gray-400 font-instrument text-sm">Total Enrollments</Text>
              <Text className="text-white font-instrument-semibold text-sm">{enrollmentCount}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </PageLayout>
  );
}

