import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PageLayout, DetailPageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { LoadingState, Alert } from '@/components/ui/feedback';
import { MultiSegmentDial } from '@/components/ui/multi-segment-dial';
import { FlowDiagram, LeadsTable, ScheduleTab, type Lead } from '@/components/campaigns';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { isWithinSchedule, isSmartleadCampaign } from '@/lib/campaigns/utils';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';
import { Tooltip } from '@/components/ui/Tooltip';
import { getCampaignById, getCampaignMailboxes, getCampaignStatsByDay, getCampaignStatsForCampaigns, type CampaignStatsByDay, type CampaignStats } from '@/lib/supabase/services/campaigns';
import { getCampaignLeadTablePage, getLeadCount } from '@/lib/supabase/services/leads';
import { supabase } from '@/lib/supabase/client';
import { CampaignStatsChart } from '@/components/campaigns/CampaignStatsChart';
import { DateInput } from '@/components/ui/DateInput';
import type { Campaign } from '@/lib/supabase/types';
import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { ArrowPathIcon, RocketLaunchIcon, PencilSquareIcon } from 'react-native-heroicons/outline';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { BottomSheet } from '@/components/ui/modals/BottomSheet';

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
  const [leadRows, setLeadRows] = useState<Lead[]>([]);
  const [leadRowsLoading, setLeadRowsLoading] = useState(false);
  const [leadRowsError, setLeadRowsError] = useState<string | null>(null);
  const [leadPage, setLeadPage] = useState(1);
  const [leadTotalCount, setLeadTotalCount] = useState(0);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [debouncedLeadSearchQuery, setDebouncedLeadSearchQuery] = useState('');
  const [leadSortColumn, setLeadSortColumn] = useState<string | undefined>('created_at');
  const [leadSortDirection, setLeadSortDirection] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState<string>('details');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [statsByDay, setStatsByDay] = useState<CampaignStatsByDay[]>([]);
  const [statsByDayLoading, setStatsByDayLoading] = useState(false);
  const [statsStartDate, setStatsStartDate] = useState<string | null>(null);
  const [statsEndDate, setStatsEndDate] = useState<string | null>(null);
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);
  const [showSmartleadRestrictedModal, setShowSmartleadRestrictedModal] = useState(false);
  const [showCampaignActionsSheet, setShowCampaignActionsSheet] = useState(false);
  const leadPageSize = 20;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLeadSearchQuery(leadSearchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [leadSearchQuery]);

  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;
  const isSmartlead = isSmartleadCampaign(campaign);

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
      if (campaignData.deleted_at) {
        setCampaign(campaignData);
        setLoadError('This campaign has been deleted.');
        setCampaignStats(null);
        return;
      }
      setCampaign(campaignData);

      const [mailboxesResult, statsResult] = await Promise.all([
        getCampaignMailboxes(id),
        getCampaignStatsForCampaigns([id]).then((m) => m[id] ?? null),
      ]);
      const mailboxes = mailboxesResult;
      setCampaignStats(statsResult);
      setMailboxCount(mailboxes?.length ?? 0);

      // Enrollments: paginate to get all (PostgREST default max is 1000 rows per request)
      const PAGE_SIZE = 1000;
      let enrollments: any[] = [];
      let enrollmentsError: Error | null = null;
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data: page, error } = await supabase
          .from('enrollments')
          .select('state, lead_id, current_node_id, stopped_reason, stopped_error_message')
          .eq('campaign_id', id)
          .is('deleted_at', null)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          enrollmentsError = error;
          break;
        }
        enrollments = enrollments.concat(page ?? []);
        if (!page || page.length < PAGE_SIZE) break;
      }

      const enrollmentCount = !enrollmentsError ? enrollments.length : 0;
      setEnrollmentCount(enrollmentCount);

      if (!enrollmentsError && enrollments.length) {
        const completed = enrollments.filter((e: any) => e.state === 'completed').length;
        const inProgress = enrollments.filter((e: any) => e.state === 'active').length;
        const stopped = enrollments.filter((e: any) => e.state === 'stopped').length;
        const paused = enrollments.filter((e: any) => e.state === 'paused').length;
        setLeadsCompleted(completed);
        setLeadsInProgress(inProgress);
        setLeadsStopped(stopped);
        setLeadsPaused(paused);
      }

      try {
        const totalLeads = await getLeadCount({ campaignId: id });
        setLeadCount(totalLeads);
        setLeadsNotStarted(Math.max(0, totalLeads - enrollmentCount));
      } catch {
        setLeadCount(0);
        setLeadsNotStarted(0);
      }
    } catch (err) {
      console.error('Error loading campaign:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load campaign');
      setCampaignStats(null);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id || activeTab !== 'leads') return;

    let cancelled = false;
    setLeadRowsLoading(true);
    setLeadRowsError(null);

    getCampaignLeadTablePage(id, {
      limit: leadPageSize,
      offset: (leadPage - 1) * leadPageSize,
      search: debouncedLeadSearchQuery || undefined,
      sortBy: leadSortColumn,
      sortDirection: leadSortDirection,
    })
      .then((result) => {
        if (cancelled) return;
        setLeadRows(result.rows);
        setLeadTotalCount(result.totalCount);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLeadRows([]);
        setLeadTotalCount(0);
        setLeadRowsError(err instanceof Error ? err.message : 'Failed to load campaign leads.');
      })
      .finally(() => {
        if (!cancelled) setLeadRowsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, debouncedLeadSearchQuery, id, leadPage, leadSortColumn, leadSortDirection]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  const loadStatsByDay = useCallback(async (bootstrapping: boolean) => {
    if (!id || !campaign) return;
    setStatsByDayLoading(true);
    try {
      let startStr: string;
      let endStr: string;

      if (!bootstrapping && statsStartDate && statsEndDate) {
        // User has set explicit dates — use them directly
        startStr = statsStartDate;
        endStr = statsEndDate;
      } else {
        // Bootstrap: fetch the widest sensible range to find the first/last entry
        startStr =
          campaign.source === 'smartlead' && campaign.smartlead_created_at
            ? campaign.smartlead_created_at.slice(0, 10)
            : campaign.created_at.slice(0, 10);
        endStr = new Date().toISOString().slice(0, 10);
      }

      const data = await getCampaignStatsByDay(id, startStr, endStr, campaign?.source ?? null);

      if (bootstrapping && data.length > 0) {
        const toDateStr = (v: string | unknown) =>
          typeof v === 'string' ? v.slice(0, 10) : new Date(v as string).toISOString().slice(0, 10);
        const first = toDateStr(data[0].date);
        const lastRow = (() => {
          for (let i = data.length - 1; i >= 0; i--) {
            const row = data[i];
            const hasActivity = (row.sent + row.replied + row.positiveReply + row.bounce) > 0;
            if (hasActivity) return row;
          }
          return data[data.length - 1];
        })();
        const last = toDateStr(lastRow.date);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const lastPlus2 = (() => {
          const d = new Date(last + 'T12:00:00Z');
          d.setUTCDate(d.getUTCDate() + 2);
          return d.toISOString().slice(0, 10);
        })();
        const bootstrapEnd = today <= lastPlus2 ? today : lastPlus2;
        setStatsStartDate(first);
        setStatsEndDate(bootstrapEnd);
        setStatsByDay(fillMissingStatsByDay(data, first, bootstrapEnd));
      } else {
        setStatsByDay(fillMissingStatsByDay(data, startStr, endStr));
      }
    } catch (err) {
      console.error('Error loading campaign stats by day:', err);
      setStatsByDay([]);
    } finally {
      setStatsByDayLoading(false);
    }
  }, [id, campaign, statsStartDate, statsEndDate]);

  // Bootstrap: run once when campaign loads on the details tab or on refresh
  useEffect(() => {
    if (id && campaign && activeTab === 'details') {
      loadStatsByDay(true);
    }
  }, [id, campaign, activeTab, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when user explicitly changes dates (skip bootstrap mode)
  useEffect(() => {
    if (id && campaign && activeTab === 'details' && statsStartDate && statsEndDate) {
      loadStatsByDay(false);
    }
  }, [statsStartDate, statsEndDate]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const detailHeader = (
    <DetailPageHeader
      breadcrumbItems={[
        { label: 'Campaigns', href: '/campaigns' },
        {
          label: isLoading ? 'Loading...' : campaign?.name ?? 'Campaign',
        },
      ]}
      backHref="/campaigns"
      title={isLoading ? 'Loading...' : campaign?.name ?? 'Campaign'}
      mobileRightAction={
        <MobileHeaderButton
          variant="actions"
          onPress={() => setShowCampaignActionsSheet(true)}
          accessibilityLabel="Campaign actions"
        />
      }
      actions={
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
      }
    />
  );

  const tabContent = campaign ? (
    <View className={isMobile ? 'pt-0' : 'pt-4'}>
      <Tabs tabs={isSmartlead ? [{ id: 'details', label: 'Details' }, { id: 'leads', label: 'Leads' }] : tabs} activeTab={activeTab} onTabChange={setActiveTab} layout={isMobile ? 'equal' : 'content'} />
            {activeTab === 'details' && (
              <>
                <View className={isMobile ? 'mb-4 pt-0 pb-0' : 'bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4'}>
                  <View className={`flex-row items-center justify-between ${isMobile ? 'mb-3' : 'mb-6'}`}>
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
                    <View style={{ flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>
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

                      <View style={{ flex: isMobile ? undefined : 1, minWidth: 0 }}>
                        <Text className="text-gray-400 font-instrument text-xs mb-3" style={isMobile ? { marginBottom: 8 } : undefined}>Lead Progress</Text>
                        {leadCount === 0 ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: isMobile ? 36 : 80, flexWrap: isMobile ? 'nowrap' : 'wrap' }}>
                            <View style={isMobile ? { width: 100, height: 100, flexShrink: 0 } : undefined}>
                              <MultiSegmentDial
                                segments={[
                                  { value: leadsNotStarted, color: '#6b7280' },
                                  { value: leadsInProgress, color: '#3b82f6' },
                                  { value: leadsPaused, color: '#8b5cf6' },
                                  { value: leadsCompleted, color: '#10b981' },
                                  { value: leadsStopped, color: '#f59e0b' },
                                ]}
                                total={leadCount}
                                size={isMobile ? 100 : 150}
                                strokeWidth={isMobile ? 8 : 10}
                                centerValue={leadsCompleted + leadsStopped}
                                centerTotal={leadCount}
                                centerTopLabel="Completed"
                                centerBottomLabel="Total"
                              />
                            </View>
                            <Text className={isMobile ? 'text-gray-500 font-instrument text-xs' : 'text-gray-500 font-instrument text-sm'}>No leads</Text>
                          </View>
                        ) : (
                          <MultiSegmentDial
                            segments={[
                              { value: leadsNotStarted, color: '#6b7280' },
                              { value: leadsInProgress, color: '#3b82f6' },
                              { value: leadsPaused, color: '#8b5cf6' },
                              { value: leadsCompleted, color: '#10b981' },
                              { value: leadsStopped, color: '#f59e0b' },
                            ]}
                            total={leadCount}
                            size={isMobile ? 100 : 150}
                            strokeWidth={isMobile ? 8 : 10}
                            centerValue={leadsCompleted + leadsStopped}
                            centerTotal={leadCount}
                            centerTopLabel="Completed"
                            centerBottomLabel="Total"
                            legend={{
                              placement: 'right',
                              compact: isMobile,
                              rows: [
                                { label: 'Not Started', color: '#6b7280', value: leadsNotStarted },
                                { label: 'In Progress', color: '#3b82f6', value: leadsInProgress },
                                { label: 'Paused', color: '#8b5cf6', value: leadsPaused },
                                { label: 'Completed', color: '#10b981', value: leadsCompleted },
                                { label: 'Stopped', color: '#f59e0b', value: leadsStopped },
                              ],
                            }}
                          />
                        )}
                      </View>
                    </View>
                  </View>
                  <View style={{ borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingTop: 24, marginTop: 24 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                      <View>
                        <Text className="text-lg font-instrument-semibold text-white">Daily activity</Text>
                        {campaign?.source === 'smartlead' && (
                          <Text className="text-sm text-neutral-400 font-instrument mt-1">Imported from Smartlead</Text>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                        <DateInput
                          label="From"
                          value={statsStartDate ?? ''}
                          onChange={(v) => setStatsStartDate(v)}
                          max={statsEndDate ?? undefined}
                          disabled={statsByDayLoading}
                        />
                        <DateInput
                          label="To"
                          value={statsEndDate ?? ''}
                          onChange={(v) => setStatsEndDate(v)}
                          min={statsStartDate ?? undefined}
                          disabled={statsByDayLoading}
                        />
                      </View>
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
                {leadRowsError ? (
                  <Alert variant="error" message={leadRowsError} />
                ) : null}
                <LeadsTable
                  leads={leadRows}
                  loading={leadRowsLoading}
                  campaignId={id!}
                  searchQuery={leadSearchQuery}
                  onSearchChange={(value) => {
                    setLeadSearchQuery(value);
                    setLeadPage(1);
                  }}
                  currentPage={leadPage}
                  totalItems={leadTotalCount}
                  onPageChange={setLeadPage}
                  sortColumn={leadSortColumn}
                  sortDirection={leadSortDirection}
                  onSortChange={(columnKey, direction) => {
                    setLeadSortColumn(columnKey);
                    setLeadSortDirection(direction);
                    setLeadPage(1);
                  }}
                  readOnly={isSmartlead}
                />
              </View>
            )}

            {activeTab === 'schedule' && (
              <View style={{ marginBottom: 16 }}>
                <ScheduleTab campaignId={id!} refreshTrigger={refreshKey} />
              </View>
            )}
    </View>
  ) : null;

  return (
    <PageLayout scrollable={false} mobileLayout="scrollable">
      {isMobile ? (
        <>
          {detailHeader}
          {isLoading && <LoadingState message="Loading campaign..." />}
          {loadError && (
            <Alert variant="error" message={loadError} actionText="Retry" onAction={() => loadCampaign()} />
          )}
          {campaign && !isLoading && !loadError && tabContent}
        </>
      ) : (
        <>
          {detailHeader}
          {isLoading ? (
            <LoadingState message="Loading campaign..." />
          ) : loadError ? (
            <View style={{ padding: 24 }}>
              <Alert variant="error" message={loadError} actionText="Retry" onAction={() => loadCampaign()} />
            </View>
          ) : campaign ? (
            <View style={{ flex: 1, paddingHorizontal: 24 }}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
              >
                {tabContent}
              </ScrollView>
            </View>
          ) : null}
        </>
      )}
      <SmartleadRestrictedModal
        visible={showSmartleadRestrictedModal}
        onClose={() => setShowSmartleadRestrictedModal(false)}
        campaignId={id ?? null}
        isOnStatsPage={true}
      />
      <BottomSheet
        visible={showCampaignActionsSheet}
        onClose={() => setShowCampaignActionsSheet(false)}
      >
        {/* Refresh */}
        <Pressable
          onPress={() => {
            handleRefresh();
            setShowCampaignActionsSheet(false);
          }}
          disabled={refreshing || isLoading}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: '#2A2A2A',
            opacity: refreshing || isLoading ? 0.6 : 1,
          }}
        >
          <ArrowPathIcon size={20} color="#9CA3AF" style={{ transform: [{ rotate: refreshing ? '180deg' : '0deg' }] }} />
          <Text className="text-white font-instrument-medium text-base">
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Text>
        </Pressable>
        {/* Mission Control */}
        {isSmartlead ? (
          <View
            style={{
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: '#2A2A2A',
              opacity: 0.6,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <RocketLaunchIcon size={20} color="#9CA3AF" />
              <Text className="text-white font-instrument-medium text-base">Mission Control</Text>
            </View>
            <Text className="text-gray-400 font-instrument text-sm pl-8">
              Only the stats dashboard is available for Smartlead campaigns.
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              handleOpenMissionControl();
              setShowCampaignActionsSheet(false);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: '#2A2A2A',
            }}
          >
            <RocketLaunchIcon size={20} color="#9CA3AF" />
            <Text className="text-white font-instrument-medium text-base">Mission Control</Text>
          </Pressable>
        )}
        {/* Edit flow — always disabled on mobile */}
        <View
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 2,
            paddingVertical: 14,
            opacity: 0.6,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <PencilSquareIcon size={20} color="#9CA3AF" />
            <Text className="text-white font-instrument-medium text-base">Edit flow</Text>
          </View>
          <Text className="text-gray-400 font-instrument text-sm pl-8">
            (Only available on desktop at the moment)
          </Text>
        </View>
      </BottomSheet>
    </PageLayout>
  );
}
