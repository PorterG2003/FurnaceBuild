import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PageLayout,
  PageHeader,
  LAYOUT_BREAKPOINT,
} from '@/components/ui/layout';
import { BottomSheet, getBottomSheetBodyScrollMaxHeight, getBottomSheetExpandedBodyHeight } from '@/components/ui/modals';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/feedback';
import { AccountMetricsToolbar } from '@/components/campaigns/AccountMetricsToolbar';
import { CampaignStatsChart } from '@/components/campaigns/CampaignStatsChart';
import { useAccount } from '@/contexts/AccountContext';
import { fillMissingStatsByDay } from '@/lib/campaigns/fillMissingStatsByDay';
import { defaultMetricsDateRange } from '@/lib/metrics/accountMetricsDateRange';
import {
  getAccountOutreachMetrics,
  getAccountOutreachStatsByDay,
  getCampaignsListSummary,
  type AccountOutreachMetrics,
  type CampaignListSummary,
  type CampaignStatsByDay,
} from '@/lib/supabase/services/campaigns';
import {
  PaperAirplaneIcon,
  CheckCircleIcon,
  UserGroupIcon,
  ClockIcon,
  FunnelIcon,
} from 'react-native-heroicons/outline';

function formatInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export default function AccountMetricsPage() {
  const { account } = useAccount();
  const { width, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const sheetBodyMaxHeight = getBottomSheetBodyScrollMaxHeight(screenHeight, insets.bottom);
  /** Taller than shrink-wrap so pickers are not clipped, but not full viewport body height. */
  const METRICS_FILTERS_BODY_HEIGHT_FRACTION = 0.72;
  const filtersExpandedBodyHeight = useMemo(
    () => getBottomSheetExpandedBodyHeight(sheetBodyMaxHeight, METRICS_FILTERS_BODY_HEIGHT_FRACTION),
    [sheetBodyMaxHeight],
  );
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  const initialRange = useMemo(() => defaultMetricsDateRange(), []);
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<CampaignListSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [metrics, setMetrics] = useState<AccountOutreachMetrics | null>(null);
  const [statsByDay, setStatsByDay] = useState<CampaignStatsByDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  const onChangeRange = useCallback((start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  useEffect(() => {
    setSelectedCampaignIds([]);
    setCampaignOptions([]);
  }, [account?.id]);

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;
    setCampaignsLoading(true);
    getCampaignsListSummary(account.id)
      .then((rows) => {
        if (cancelled) return;
        setCampaignOptions(rows.filter((c) => c.source !== 'smartlead'));
      })
      .catch(() => {
        if (!cancelled) setCampaignOptions([]);
      })
      .finally(() => {
        if (!cancelled) setCampaignsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.id]);

  useEffect(() => {
    setWarningDismissed(false);
  }, [account?.id, startDate, endDate, selectedCampaignIds]);

  const load = useCallback(async () => {
    if (!account?.id) return;
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      setError('Start date must be on or before end date.');
      setMetrics(null);
      setStatsByDay([]);
      return;
    }
    setLoading(true);
    setError(null);
    const campaignFilter =
      selectedCampaignIds.length > 0 ? selectedCampaignIds : undefined;
    try {
      const [summary, byDay] = await Promise.all([
        getAccountOutreachMetrics(account.id, startDate, endDate, campaignFilter),
        getAccountOutreachStatsByDay(account.id, startDate, endDate, campaignFilter),
      ]);
      setMetrics(summary);
      setStatsByDay(fillMissingStatsByDay(byDay, startDate, endDate));
    } catch (e) {
      setMetrics(null);
      setStatsByDay([]);
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [account?.id, startDate, endDate, selectedCampaignIds]);

  useEffect(() => {
    load();
  }, [load]);

  const metricsToolbarProps = {
    startDate,
    endDate,
    onChangeRange,
    campaignIds: selectedCampaignIds,
    onChangeCampaignIds: setSelectedCampaignIds,
    campaignOptions,
    loading,
    campaignsLoading,
  };

  const hasActiveFilters = selectedCampaignIds.length > 0;

  const headerActions = isMobile ? (
    <Pressable
      onPress={() => setFiltersSheetOpen(true)}
      accessibilityRole="button"
      accessibilityLabel="Filters"
      className="rounded-xl items-center justify-center"
      style={{
        width: 44,
        height: 44,
        backgroundColor: '#1A1A1A',
        borderColor: '#2A2A2A',
        borderWidth: 1,
      }}
    >
      <FunnelIcon size={18} color={hasActiveFilters ? '#F3440D' : '#9CA3AF'} />
    </Pressable>
  ) : (
    <View className="min-w-0 max-w-[min(100%,920px)] shrink">
      <AccountMetricsToolbar {...metricsToolbarProps} />
    </View>
  );

  const alerts = (
    <>
      {error ? (
        <Alert variant="error" message={error} actionText="Retry" onAction={load} className="mb-4" />
      ) : null}
      {metrics?.smartleadImportWarning === true && !warningDismissed ? (
        <Alert
          variant="warning"
          message="A Smartlead import finished on or after the start of this range. These totals only include activity from campaigns sent through Furnace, not historical Smartlead sends."
          actionText="Dismiss"
          onAction={() => setWarningDismissed(true)}
          className="mb-4"
        />
      ) : null}
    </>
  );

  const metricsCards = (
    <View className={isMobile ? 'flex-row flex-wrap gap-3 mb-6' : 'flex-row flex-wrap gap-4 mb-8'}>
      <MetricCard
        title="Total sent"
        subtitle="Emails (not deduped by lead)"
        icon={PaperAirplaneIcon}
        color="#a78bfa"
        value={metrics?.totalSent}
        loading={loading}
        compact={isMobile}
      />
      <MetricCard
        title="Total positive replies"
        subtitle="Interested (event count)"
        icon={CheckCircleIcon}
        color="#10b981"
        value={metrics?.totalPositiveReply}
        loading={loading}
        compact={isMobile}
      />
      <MetricCard
        title="Leads reached"
        subtitle="Unique leads across campaigns"
        icon={UserGroupIcon}
        color="#38bdf8"
        value={metrics?.leadsReached}
        loading={loading}
        compact={isMobile}
      />
      <MetricCard
        title="Leads in queue"
        subtitle="Active, running, not yet sent"
        icon={ClockIcon}
        color="#f59e0b"
        value={metrics?.leadsInQueue}
        loading={loading}
        compact={isMobile}
      />
    </View>
  );

  const chartSection = (
    <View className="mb-8">
      <Text className="text-lg font-instrument-semibold text-white mb-4">Daily activity</Text>
      <CampaignStatsChart data={statsByDay} loading={loading} />
    </View>
  );

  return (
    <PageLayout>
      <PageHeader
        title="Outreach metrics"
        subtitle={isMobile ? 'Sends and replies (UTC)' : 'Furnace sends and replies for your campaigns (UTC dates)'}
        primaryAction={headerActions}
      />
      {alerts}
      {metricsCards}
      {chartSection}
      {isMobile ? (
        <BottomSheet
          visible={filtersSheetOpen}
          onClose={() => setFiltersSheetOpen(false)}
          expandBodyToMax
          expandBodyHeightFraction={METRICS_FILTERS_BODY_HEIGHT_FRACTION}
        >
          <ScrollView
            style={{ flex: 1, minHeight: 0, maxHeight: filtersExpandedBodyHeight }}
            contentContainerStyle={{ paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <AccountMetricsToolbar variant="sheet" {...metricsToolbarProps} />
          </ScrollView>
        </BottomSheet>
      ) : null}
    </PageLayout>
  );
}

function MetricCard({
  title,
  subtitle,
  icon: Icon,
  color,
  value,
  loading,
  compact = false,
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ size?: number; color?: string }>;
  color: string;
  value: number | undefined;
  loading: boolean;
  compact?: boolean;
}) {
  const display =
    loading || value === undefined ? '—' : formatInt(value);
  return (
    <Card
      variant="card"
      className={
        compact
          ? 'flex-1 min-w-[140px] p-3'
          : 'flex-1 min-w-[140px] max-w-[220px] p-4'
      }
    >
      <View className="flex-row items-center gap-2 mb-2">
        <Icon size={compact ? 16 : 18} color={color} />
        <Text
          className={`text-white font-instrument-semibold flex-1 ${compact ? 'text-sm' : 'text-base'}`}
          numberOfLines={2}
        >
          {title}
        </Text>
      </View>
      <Text className="text-gray-500 font-instrument text-xs mb-3">{subtitle}</Text>
      <Text
        className={`font-instrument-semibold ${compact ? 'text-2xl' : 'text-3xl'}`}
        style={{ color }}
      >
        {display}
      </Text>
    </Card>
  );
}
