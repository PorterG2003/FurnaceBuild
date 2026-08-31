import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { DetailPageShell, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, usePageSkeleton, useToast } from '@/components/ui/feedback';
import { CampaignDetailSkeleton } from '@/components/skeletons';
import { MultiSegmentDial } from '@/components/ui/multi-segment-dial';
import {
  CampaignLeadFiltersModal,
  EMPTY_CAMPAIGN_LEAD_FILTERS,
  LeadsTable,
  ScheduleTab,
  CampaignStatusMenu,
  CampaignStatusActionsSheet,
  RenameCampaignModal,
  type CampaignStatusMenuStatus,
  countActiveCampaignLeadFilters,
  type CampaignLeadFilters,
  type Lead,
  FlowDiagram,
} from '@/components/campaigns';
import { downloadCsvOnWeb, exportCampaignLeadsToCsv } from '@/components/campaigns/exportCampaignLeadsCsv';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { isWithinSchedule, isSmartleadCampaign } from '@/lib/campaigns/utils';
import {
  formatVariantPerfCells,
  type VariantPerfCellValue,
} from '@/lib/campaigns/formatVariantPerfCells';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  getCampaignById,
  getCampaignLifetimeSentCount,
  getCampaignStatsByDay,
  getCampaignStatsDailyActivityRange,
  getCampaignLeadProgressBuckets,
  getCampaignVariantStats,
  type CampaignStatsByDay,
  type CampaignVariantStatRow,
} from '@/lib/supabase/services/campaigns';
import {
  fetchAllCampaignLeadIds,
  getCampaignLeadTablePage,
  getCampaignLeadTableExportRows,
  deleteLeadsBestEffort,
} from '@/lib/supabase/services/leads';
import { supabase } from '@/lib/supabase/client';
import { AccountTrendChart } from '@/components/campaigns/AccountTrendChart';
import { DateInput } from '@/components/ui/DateInput';
import type { Campaign } from '@/lib/supabase/types';
import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  PencilIcon,
  RectangleStackIcon,
  RocketLaunchIcon,
} from 'react-native-heroicons/outline';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { BottomSheet } from '@/components/ui/modals/BottomSheet';
import { ConfirmModal } from '@/components/ui/modals/ConfirmModal';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { LEGACY_EMAIL_VARIANT_ID, sortVariantsForRoundRobin } from '@/lib/email/emailNodeVariants';
import { CAMPAIGN_STAT_COLORS } from '@/lib/campaigns/campaignStatColors';
import { getEmailNodesInSendOrder } from '@/lib/campaigns/emailNodeSendOrder';
import { fillMissingStatsByDay } from '@/lib/campaigns/fillMissingStatsByDay';
import {
  campaignChartBootstrapEnd,
  isCampaignDailyStatsCacheMiss,
} from '@/lib/campaigns/campaignDetailsStats';
import { trendChartGrain } from '@/lib/metrics/accountMetricsDateRange';
import { formatWeekLabel, rollupDailyToIsoWeeks } from '@/lib/metrics/weeklyRollup';
import { useCampaignStatusActions } from '@/lib/campaigns/useCampaignStatusActions';
import { useCampaignTags } from '@/lib/campaigns/useCampaignTags';
import { CampaignTagsSection } from '@/components/campaigns/CampaignTagsSection';
import { useAccount } from '@/contexts/AccountContext';

function toStatusMenuStatus(status: string | null | undefined): CampaignStatusMenuStatus {
  if (status === 'running' || status === 'paused' || status === 'stopped' || status === 'draft' || status === 'scheduled') {
    return status;
  }
  return 'draft';
}

const tabs: Tab[] = [
  { id: 'details', label: 'Details' },
  { id: 'leads', label: 'Leads' },
  { id: 'schedule', label: 'Schedule' },
];

function statLookup(
  stats: CampaignVariantStatRow[],
  flowNodeId: string | null,
  variantId: string
): { sent: number; replied: number; positiveReply: number; bounced: number } {
  const row = stats.find(
    (s) => s.flowNodeId === flowNodeId && s.variantId === variantId
  );
  return {
    sent: row?.sent ?? 0,
    replied: row?.replied ?? 0,
    positiveReply: row?.positiveReply ?? 0,
    bounced: row?.bounced ?? 0,
  };
}

function formatCampaignLeadExportFilename(campaignName: string | null | undefined, campaignId: string): string {
  const baseName = (campaignName ?? 'campaign-leads')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const safeBaseName = baseName || 'campaign-leads';
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${safeBaseName}-${campaignId}-${timestamp}.csv`;
}

/** Full-width table: five equal flex columns with a shared min width so none dominates. */
const VARIANT_PERF_COL_MIN = 72;
const variantPerfCol = {
  flex: 1,
  minWidth: VARIANT_PERF_COL_MIN,
  flexShrink: 1,
  paddingRight: 8,
} as const;
const variantPerfHeaderLabelWeb = Platform.select({
  web: { whiteSpace: 'nowrap' as const },
  default: {},
});

/** Variant performance table — stats match the campaign trend chart; variant column uses one neutral hue. */
/** Use `cell` not `value` for body text colors: Reanimated warns on `.value` inside inline `style` objects. */
const VARIANT_PERF_COLORS = {
  variant: { header: '#94a3b8', cell: '#94a3b8' },
  sent: { header: CAMPAIGN_STAT_COLORS.sent, cell: CAMPAIGN_STAT_COLORS.sent },
  reply: { header: CAMPAIGN_STAT_COLORS.replied, cell: CAMPAIGN_STAT_COLORS.replied },
  interested: {
    header: CAMPAIGN_STAT_COLORS.positiveReply,
    cell: CAMPAIGN_STAT_COLORS.positiveReply,
  },
  bounce: { header: CAMPAIGN_STAT_COLORS.bounce, cell: CAMPAIGN_STAT_COLORS.bounce },
} as const;

const VARIANT_PERF_NA_COLOR = '#6b7280';

function VariantPerfStatText({
  cell,
  color,
}: {
  cell: VariantPerfCellValue;
  color: string;
}) {
  if (cell === '—') {
    return (
      <Text
        style={{
          color: VARIANT_PERF_NA_COLOR,
          fontSize: 14,
          textAlign: 'left',
          fontWeight: '600',
        }}
      >
        —
      </Text>
    );
  }
  return (
    <Text
      style={{
        color,
        fontSize: 14,
        textAlign: 'left',
        fontWeight: '600',
      }}
    >
      {cell.value}
      <Text style={{ color: VARIANT_PERF_NA_COLOR, fontSize: 13, fontWeight: '400' }}> ({cell.pct}%)</Text>
    </Text>
  );
}

export default function CampaignPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [leadCount, setLeadCount] = useState(0);
  const [leadsNotStarted, setLeadsNotStarted] = useState(0);
  const [leadsInProgress, setLeadsInProgress] = useState(0);
  const [leadsCompleted, setLeadsCompleted] = useState(0);
  const [leadsStopped, setLeadsStopped] = useState(0);
  const [leadsPaused, setLeadsPaused] = useState(0);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [leadRows, setLeadRows] = useState<Lead[]>([]);
  const [leadRowsLoading, setLeadRowsLoading] = useState(false);
  const [leadRowsError, setLeadRowsError] = useState<string | null>(null);
  const [leadPage, setLeadPage] = useState(1);
  const [leadTotalCount, setLeadTotalCount] = useState(0);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [debouncedLeadSearchQuery, setDebouncedLeadSearchQuery] = useState('');
  const [leadFilters, setLeadFilters] = useState<CampaignLeadFilters>(EMPTY_CAMPAIGN_LEAD_FILTERS);
  const [leadFiltersOpen, setLeadFiltersOpen] = useState(false);
  const [leadSortColumn, setLeadSortColumn] = useState<string | undefined>('created_at');
  const [leadSortDirection, setLeadSortDirection] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState<string>('details');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [statsByDay, setStatsByDay] = useState<CampaignStatsByDay[]>([]);
  const [statsByDayLoading, setStatsByDayLoading] = useState(false);
  const [statsByDayError, setStatsByDayError] = useState<string | null>(null);
  const [statsStartDate, setStatsStartDate] = useState<string | null>(null);
  const [statsEndDate, setStatsEndDate] = useState<string | null>(null);
  const skipNextStatsRangeFetchRef = useRef(false);
  const [variantStats, setVariantStats] = useState<CampaignVariantStatRow[]>([]);
  const [variantStatsLoading, setVariantStatsLoading] = useState(false);
  const [variantStatsError, setVariantStatsError] = useState<string | null>(null);
  const [showSmartleadRestrictedModal, setShowSmartleadRestrictedModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showCampaignActionsSheet, setShowCampaignActionsSheet] = useState(false);
  const [showStatusActionsSheet, setShowStatusActionsSheet] = useState(false);
  const pendingOpenStatusActionsRef = useRef(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set());
  const [leadsRefreshNonce, setLeadsRefreshNonce] = useState(0);
  const [bulkRemovingLeads, setBulkRemovingLeads] = useState(false);
  const [exportingLeads, setExportingLeads] = useState(false);
  const [leadRemoveConfirmOpen, setLeadRemoveConfirmOpen] = useState(false);
  const [leadRemoveBanner, setLeadRemoveBanner] = useState<{
    variant: 'warning' | 'error';
    message: string;
  } | null>(null);
  const { toast } = useToast();
  const { account } = useAccount();
  const leadPageSize = 20;
  const tagCampaignIds = useMemo(() => (id ? [id] : []), [id]);
  const {
    accountCampaignTags,
    campaignTagsMap,
    handleTagCreated,
    handleAddTagToCampaign,
    handleRemoveTagFromCampaign,
    handleUpdateTag,
    handleDeleteTag,
  } = useCampaignTags(account?.id ?? campaign?.account_id ?? null, tagCampaignIds);
  const campaignTags = id ? (campaignTagsMap[id] ?? []) : [];

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLeadSearchQuery(leadSearchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [leadSearchQuery]);

  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;
  const { showPlaceholder } = usePageSkeleton(isLoading);
  const isSmartlead = isSmartleadCampaign(campaign);
  const statsGrain = useMemo((): 'day' | 'week' => {
    if (!statsStartDate || !statsEndDate) return 'day';
    return trendChartGrain(statsStartDate, statsEndDate);
  }, [statsStartDate, statsEndDate]);
  const weeklyOutcomes = useMemo(() => rollupDailyToIsoWeeks(statsByDay), [statsByDay]);
  const trendPeriods = useMemo(
    () =>
      statsGrain === 'day'
        ? statsByDay.map((day) => ({
            label: day.date,
            sent: day.sent,
            leadsFirstContacted: day.leadsFirstContacted,
            bounce: day.bounce,
            replied: day.replied,
            positiveReply: day.positiveReply,
          }))
        : weeklyOutcomes.map((week) => ({
            label: week.weekStart,
            sent: week.sent,
            leadsFirstContacted: week.leadsFirstContacted,
            bounce: week.bounce,
            replied: week.replied,
            positiveReply: week.positiveReply,
          })),
    [statsGrain, statsByDay, weeklyOutcomes],
  );
  const trendLabels = useMemo(
    () => trendPeriods.map((period) => formatWeekLabel(period.label)),
    [trendPeriods],
  );
  const trendPanels = useMemo(() => {
    const volumeSeries = [
      {
        name: 'Emails sent',
        color: CAMPAIGN_STAT_COLORS.sent,
        data: trendPeriods.map((period) => period.sent),
      },
      ...(!isSmartlead
        ? [
            {
              name: 'Leads reached',
              color: '#38bdf8',
              data: trendPeriods.map((period) => period.leadsFirstContacted),
            },
          ]
        : []),
      {
        name: 'Bounced',
        color: CAMPAIGN_STAT_COLORS.bounce,
        data: trendPeriods.map((period) => period.bounce),
      },
    ];
    return [
      { series: volumeSeries },
      {
        series: [
          {
            name: 'Replies',
            color: CAMPAIGN_STAT_COLORS.replied,
            data: trendPeriods.map((period) => period.replied),
          },
          {
            name: 'Positive',
            color: CAMPAIGN_STAT_COLORS.positiveReply,
            data: trendPeriods.map((period) => period.positiveReply),
          },
        ],
      },
    ];
  }, [isSmartlead, trendPeriods]);
  const activeLeadFilterCount = useMemo(() => countActiveCampaignLeadFilters(leadFilters), [leadFilters]);
  const leadFilterKey = useMemo(
    () =>
      JSON.stringify({
        enrollmentStates: [...leadFilters.enrollmentStates].sort(),
        replyCategories: [...leadFilters.replyCategories].sort(),
      }),
    [leadFilters],
  );

  const handleFetchLeadViewKeys = useCallback(async () => {
    if (!id) return [];
    const { leadIds } = await fetchAllCampaignLeadIds(id, {
      search: debouncedLeadSearchQuery || undefined,
      sortBy: leadSortColumn,
      sortDirection: leadSortDirection,
      enrollmentStates: leadFilters.enrollmentStates.length > 0 ? leadFilters.enrollmentStates : undefined,
      replyCategories: leadFilters.replyCategories.length > 0 ? leadFilters.replyCategories : undefined,
    });
    return leadIds;
  }, [
    debouncedLeadSearchQuery,
    id,
    leadFilters.enrollmentStates,
    leadFilters.replyCategories,
    leadSortColumn,
    leadSortDirection,
  ]);

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
      if (campaignData.deleted_at) {
        setCampaign(campaignData);
        setLoadError('This campaign has been deleted.');
        return;
      }
      setCampaign(campaignData);
    } catch (err) {
      console.error('Error loading campaign:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load campaign');
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
      enrollmentStates: leadFilters.enrollmentStates.length > 0 ? leadFilters.enrollmentStates : undefined,
      replyCategories: leadFilters.replyCategories.length > 0 ? leadFilters.replyCategories : undefined,
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
  }, [activeTab, debouncedLeadSearchQuery, id, leadFilterKey, leadFilters.enrollmentStates, leadPage, leadSortColumn, leadSortDirection, leadsRefreshNonce]);

  useEffect(() => {
    setSelectedLeadIds(new Set());
  }, [debouncedLeadSearchQuery, leadFilterKey, leadSortColumn, leadSortDirection]);

  useEffect(() => {
    setLeadRemoveBanner(null);
  }, [debouncedLeadSearchQuery, leadFilterKey, leadSortColumn, leadSortDirection]);

  useEffect(() => {
    setLeadPage(1);
  }, [leadFilterKey]);

  useEffect(() => {
    if (activeTab !== 'leads') {
      setSelectedLeadIds(new Set());
      setLeadRemoveConfirmOpen(false);
      setLeadFiltersOpen(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!leadRemoveBanner) return;
    const t = setTimeout(() => setLeadRemoveBanner(null), 12000);
    return () => clearTimeout(t);
  }, [leadRemoveBanner]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(Math.max(0, leadTotalCount) / leadPageSize));
    if (leadPage > totalPages) {
      setLeadPage(totalPages);
    }
  }, [leadTotalCount, leadPage, leadPageSize]);

  const performRemoveSelectedLeads = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || !id) return;
      setBulkRemovingLeads(true);
      setLeadRemoveBanner(null);
      try {
        const { succeeded, failed } = await deleteLeadsBestEffort(ids);
        setSelectedLeadIds((prev) => {
          const next = new Set(prev);
          succeeded.forEach((leadId) => next.delete(leadId));
          return next;
        });
        setLeadsRefreshNonce((n) => n + 1);
        await loadCampaign(true);
        const emailById = new Map(leadRows.map((row) => [row.id, row.email] as const));
        if (failed.length === 0) {
          toast.success(`Removed ${succeeded.length} lead(s) from this campaign.`);
        } else {
          const detail = failed
            .slice(0, 5)
            .map((f) => `• ${emailById.get(f.id) ?? f.id}: ${f.error}`)
            .join('\n');
          const more = failed.length > 5 ? ` …and ${failed.length - 5} more.` : '';
          setLeadRemoveBanner({
            variant: succeeded.length > 0 ? 'warning' : 'error',
            message:
              succeeded.length > 0
                ? `Removed ${succeeded.length} lead(s). ${failed.length} failed: ${detail}${more}`
                : `${failed.length} lead(s) could not be removed: ${detail}${more}`,
          });
        }
      } catch (err) {
        setLeadRemoveBanner({
          variant: 'error',
          message: err instanceof Error ? err.message : 'Removal failed.',
        });
      } finally {
        setBulkRemovingLeads(false);
      }
    },
    [id, leadRows, loadCampaign, toast],
  );

  const openLeadRemoveConfirm = useCallback(() => {
    if (selectedLeadIds.size === 0 || !id) return;
    setLeadRemoveConfirmOpen(true);
  }, [id, selectedLeadIds.size]);

  const handleConfirmRemoveLeads = useCallback(() => {
    setLeadRemoveConfirmOpen(false);
    const ids = [...selectedLeadIds];
    void performRemoveSelectedLeads(ids);
  }, [performRemoveSelectedLeads, selectedLeadIds]);

  const handleExportLeads = useCallback(async () => {
    if (!id || exportingLeads) return;
    if (Platform.OS !== 'web') {
      toast.info('Lead export is currently available on web only.');
      return;
    }

    setExportingLeads(true);
    try {
      const exportingSelectedLeads = selectedLeadIds.size > 0;
      const rows = await getCampaignLeadTableExportRows(id, {
        search: exportingSelectedLeads ? undefined : debouncedLeadSearchQuery || undefined,
        sortBy: leadSortColumn,
        sortDirection: leadSortDirection,
        enrollmentStates:
          exportingSelectedLeads || leadFilters.enrollmentStates.length === 0
            ? undefined
            : leadFilters.enrollmentStates,
        replyCategories:
          exportingSelectedLeads || leadFilters.replyCategories.length === 0
            ? undefined
            : leadFilters.replyCategories,
        leadIds: exportingSelectedLeads ? [...selectedLeadIds] : undefined,
      });

      if (rows.length === 0) {
        toast.info(exportingSelectedLeads ? 'No selected leads to export.' : 'No leads match the current filters.');
        return;
      }

      const csv = exportCampaignLeadsToCsv(rows);
      downloadCsvOnWeb(formatCampaignLeadExportFilename(campaign?.name, id), csv);
      toast.success(
        exportingSelectedLeads ? `Exported ${rows.length} selected lead(s).` : `Exported ${rows.length} lead(s).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export leads.');
    } finally {
      setExportingLeads(false);
    }
  }, [
    campaign?.name,
    debouncedLeadSearchQuery,
    exportingLeads,
    id,
    leadFilters.enrollmentStates,
    leadFilters.replyCategories,
    leadSortColumn,
    leadSortDirection,
    selectedLeadIds,
    toast,
  ]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  useEffect(() => {
    if (!id || !campaign || campaign.deleted_at) return;
    let cancelled = false;
    setProgressLoading(true);
    setProgressError(null);
    getCampaignLeadProgressBuckets(id)
      .then((progressBuckets) => {
        if (cancelled) return;
        setLeadCount(progressBuckets.totalLeads);
        setLeadsNotStarted(progressBuckets.notStarted);
        setLeadsInProgress(progressBuckets.inProgress);
        setLeadsPaused(progressBuckets.paused);
        setLeadsCompleted(progressBuckets.completed);
        setLeadsStopped(progressBuckets.stopped);
      })
      .catch((progressErr: unknown) => {
        if (cancelled) return;
        console.error('Error loading campaign lead progress:', progressErr);
        setProgressError(
          progressErr instanceof Error ? progressErr.message : 'Failed to load lead progress.',
        );
      })
      .finally(() => {
        if (!cancelled) setProgressLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, campaign?.id, campaign?.deleted_at, refreshKey]);

  const {
    isPausing,
    isStarting: isResuming,
    isStopping,
    handlePause,
    handleResume,
    handleStop,
  } = useCampaignStatusActions(id, loadCampaign);

  useEffect(() => {
    skipNextStatsRangeFetchRef.current = false;
    setStatsStartDate(null);
    setStatsEndDate(null);
    setStatsByDay([]);
    setStatsByDayError(null);
  }, [id]);

  useEffect(() => {
    if (!id || !campaign || campaign.deleted_at || activeTab !== 'details') return;

    if (skipNextStatsRangeFetchRef.current) {
      skipNextStatsRangeFetchRef.current = false;
      return;
    }

    let cancelled = false;
    setStatsByDayLoading(true);
    setStatsByDayError(null);

    const load = async () => {
      const sentCount = await getCampaignLifetimeSentCount(id);
      if (cancelled) return;

      let startStr = statsStartDate;
      let endStr = statsEndDate;
      let bootstrapping = false;

      if (!startStr || !endStr) {
        bootstrapping = true;
        const range = await getCampaignStatsDailyActivityRange(id, campaign.source ?? null);
        if (cancelled) return;
        if (!range) {
          if (isCampaignDailyStatsCacheMiss({ series: [], lifetimeSentCount: sentCount })) {
            setStatsByDayError('Daily stats cache is empty while this campaign has sends. Reconcile campaign stats.');
            return;
          }
          setStatsByDay([]);
          return;
        }
        startStr = range.startDate;
        endStr = campaignChartBootstrapEnd(range.endDate);
      }

      const data = await getCampaignStatsByDay(id, startStr, endStr, campaign.source ?? null);
      if (cancelled) return;
      const filled = fillMissingStatsByDay(data, startStr, endStr);
      if (isCampaignDailyStatsCacheMiss({ series: filled, lifetimeSentCount: sentCount })) {
        setStatsByDayError('Daily stats cache is empty while this campaign has sends. Reconcile campaign stats.');
        return;
      }
      if (bootstrapping) {
        skipNextStatsRangeFetchRef.current = true;
        setStatsStartDate(startStr);
        setStatsEndDate(endStr);
      }
      setStatsByDay(filled);
    };

    load()
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Error loading campaign stats by day:', err);
        setStatsByDayError(err instanceof Error ? err.message : 'Failed to load daily trends.');
      })
      .finally(() => {
        if (!cancelled) setStatsByDayLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, campaign?.id, campaign?.source, campaign?.deleted_at, activeTab, statsStartDate, statsEndDate, refreshKey]);

  useEffect(() => {
    if (!id || activeTab !== 'details' || !campaign || isSmartlead) {
      return;
    }
    let cancelled = false;
    setVariantStatsLoading(true);
    setVariantStatsError(null);
    getCampaignVariantStats(id)
      .then((rows) => {
        if (!cancelled) setVariantStats(rows);
      })
      .catch((err) => {
        console.error('Variant stats:', err);
        if (!cancelled) {
          setVariantStatsError(err instanceof Error ? err.message : 'Failed to load variant stats.');
        }
      })
      .finally(() => {
        if (!cancelled) setVariantStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, campaign?.id, activeTab, refreshKey, isSmartlead]);

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

  const showStatusMenu = campaign != null && !isLoading && !loadError;
  const statusMenuProps = {
    status: toStatusMenuStatus(campaign?.status) as CampaignStatusMenuStatus,
    campaignName: campaign?.name ?? undefined,
    readOnly: isSmartlead,
    isPausing,
    isStarting: isResuming,
    isStopping,
    onPause: isSmartlead ? undefined : handlePause,
    onResume: isSmartlead ? undefined : handleResume,
    onStop: isSmartlead ? undefined : handleStop,
  };

  useEffect(() => {
    if (showCampaignActionsSheet) {
      pendingOpenStatusActionsRef.current = false;
    }
  }, [showCampaignActionsSheet]);

  const openStatusActionsFromCampaignSheet = useCallback(() => {
    pendingOpenStatusActionsRef.current = true;
    setShowCampaignActionsSheet(false);
  }, []);

  const handleCampaignActionsSheetAfterClose = useCallback(() => {
    if (!pendingOpenStatusActionsRef.current) return;
    pendingOpenStatusActionsRef.current = false;
    setShowStatusActionsSheet(true);
  }, []);

  const statusMenu = showStatusMenu ? <CampaignStatusMenu {...statusMenuProps} /> : null;
  const statusMenuInActionsSheet = showStatusMenu ? (
    <CampaignStatusMenu
      {...statusMenuProps}
      onOpenMobileActionsSheet={openStatusActionsFromCampaignSheet}
    />
  ) : null;

  const headerActions = (
    <>
      {!isMobile && statusMenu}
      <Button
        variant="secondary"
        size="sm"
        onPress={handleRefresh}
        disabled={refreshing || isLoading}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ArrowPathIcon size={16} color="#9ca3af" style={{ transform: [{ rotate: refreshing ? '180deg' : '0deg' }] }} />
          <Text className="text-gray-300 font-instrument text-sm">
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Text>
        </View>
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setShowRenameModal(true)}
      >
        Rename
      </Button>
      {isSmartlead ? (
        <Tooltip content={<Text className="text-gray-300 font-instrument text-xs">Only the stats dashboard is available for Smartlead campaigns.</Text>}>
          <Button
            variant="secondary"
            size="sm"
            className="opacity-50"
            onPress={handleOpenMissionControl}
          >
            Mission Control
          </Button>
        </Tooltip>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onPress={handleOpenMissionControl}
        >
          Mission Control
        </Button>
      )}
      {isSmartlead ? (
        <Tooltip content={<Text className="text-gray-300 font-instrument text-xs">Only the stats dashboard is available for Smartlead campaigns.</Text>}>
          <Button
            variant="secondary"
            size="sm"
            className="opacity-50"
            onPress={handleEditFlow}
          >
            Edit flow
          </Button>
        </Tooltip>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onPress={handleEditFlow}
        >
          Edit flow
        </Button>
      )}
    </>
  );

  const tabContent = campaign ? (
    <View className={isMobile ? 'pt-0' : 'pt-4'}>
      <Tabs tabs={isSmartlead ? [{ id: 'details', label: 'Details' }, { id: 'leads', label: 'Leads' }] : tabs} activeTab={activeTab} onTabChange={setActiveTab} layout={isMobile ? 'equal' : 'content'} />
            {activeTab === 'details' && (
              <>
                <View className={isMobile ? 'mb-4 pt-0 pb-0' : 'bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4'}>
                  <View className={`flex-row items-center justify-between ${isMobile ? 'mb-3' : 'mb-6'}`}>
                    <Text className="text-lg font-instrument-semibold text-white">Campaign Overview</Text>
                  </View>

                  <View style={{ gap: 24 }}>
                    {account?.id && id ? (
                      <View>
                        <Text className="text-gray-400 font-instrument text-xs mb-2">Tags</Text>
                        <CampaignTagsSection
                          accountId={account.id}
                          campaignId={id}
                          tags={campaignTags}
                          accountTags={accountCampaignTags}
                          onTagCreated={handleTagCreated}
                          onAddTag={handleAddTagToCampaign}
                          onRemoveTag={handleRemoveTagFromCampaign}
                          onUpdateTag={handleUpdateTag}
                          onDeleteTag={handleDeleteTag}
                          showChipRow
                        />
                      </View>
                    ) : null}
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
                        {progressLoading && leadCount === 0 && !progressError ? (
                          <Text className="text-gray-500 font-instrument text-sm">Loading lead progress…</Text>
                        ) : progressError ? (
                          <Text className="text-red-400 font-instrument text-sm">{progressError}</Text>
                        ) : leadCount === 0 ? (
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
                  {!isSmartlead && flowData?.nodes && (
                    <View style={{ borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingTop: 24, marginTop: 24 }}>
                      <Text className="text-lg font-instrument-semibold text-white mb-3">Variant performance</Text>
                      {variantStatsLoading ? (
                        <Text className="text-gray-500 font-instrument text-sm">Loading variant stats…</Text>
                      ) : variantStatsError ? (
                        <Text className="text-red-400 font-instrument text-sm">{variantStatsError}</Text>
                      ) : (
                        <View style={{ width: '100%', alignSelf: 'stretch' }}>
                            {getEmailNodesInSendOrder(flowData as { nodes?: any[]; edges?: any[] })
                              .map((node: any) => {
                                const flowId = node.id as string;
                                const rawVariants = node.data?.variants;
                                const variants =
                                  Array.isArray(rawVariants) && rawVariants.length > 0
                                    ? sortVariantsForRoundRobin(
                                        rawVariants.map((v: any, i: number) => ({
                                          id: String(v.id ?? `${flowId}-v-${i}`),
                                          label: String(v.label ?? '?'),
                                          subject: String(v.subject ?? ''),
                                          template: String(v.template ?? ''),
                                          isActive: v.isActive !== false,
                                          order: typeof v.order === 'number' ? v.order : i,
                                        }))
                                      )
                                    : [
                                        {
                                          id: LEGACY_EMAIL_VARIANT_ID,
                                          label: 'A',
                                          subject: String(node.data?.subject ?? ''),
                                          template: String(node.data?.template ?? ''),
                                          isActive: true,
                                          order: 0,
                                        },
                                      ];
                                const nodeTitle = node.data?.label || 'Send Email';
                                const isPriorityEmail = node.data?.priority === true;
                                return (
                                  <View key={flowId} style={{ marginBottom: 20 }}>
                                    <Text className="text-white font-instrument-medium text-sm mb-2">{nodeTitle}</Text>
                                    <View
                                      style={{
                                        width: '100%',
                                        alignSelf: 'stretch',
                                        borderWidth: 1,
                                        borderColor: '#2A2A2A',
                                        borderRadius: 8,
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <View
                                        style={{
                                          flexDirection: 'row',
                                          flexWrap: 'nowrap',
                                          width: '100%',
                                          backgroundColor: '#252525',
                                          paddingVertical: 12,
                                          paddingHorizontal: 12,
                                          borderBottomWidth: 1,
                                          borderBottomColor: '#2A2A2A',
                                          alignItems: 'center',
                                        }}
                                      >
                                        <View style={variantPerfCol}>
                                          <View
                                            style={{
                                              flexDirection: 'row',
                                              alignItems: 'center',
                                              justifyContent: 'flex-start',
                                              gap: 6,
                                            }}
                                          >
                                            <RectangleStackIcon
                                              size={15}
                                              color={VARIANT_PERF_COLORS.variant.header}
                                            />
                                            <Text
                                              style={{
                                                flex: 1,
                                                minWidth: 0,
                                                color: VARIANT_PERF_COLORS.variant.header,
                                                fontSize: 11,
                                                textAlign: 'left',
                                                fontWeight: '600',
                                                ...variantPerfHeaderLabelWeb,
                                              }}
                                              numberOfLines={1}
                                            >
                                              Variant
                                            </Text>
                                          </View>
                                        </View>
                                        <View style={variantPerfCol}>
                                          <View
                                            style={{
                                              flexDirection: 'row',
                                              alignItems: 'center',
                                              justifyContent: 'flex-start',
                                              gap: 6,
                                            }}
                                          >
                                            <PaperAirplaneIcon size={15} color={VARIANT_PERF_COLORS.sent.header} />
                                            <Text
                                              style={{
                                                flex: 1,
                                                minWidth: 0,
                                                color: VARIANT_PERF_COLORS.sent.header,
                                                fontSize: 11,
                                                textAlign: 'left',
                                                fontWeight: '600',
                                                ...variantPerfHeaderLabelWeb,
                                              }}
                                              numberOfLines={1}
                                            >
                                              Sent
                                            </Text>
                                          </View>
                                        </View>
                                        <View style={variantPerfCol}>
                                          <View
                                            style={{
                                              flexDirection: 'row',
                                              alignItems: 'center',
                                              justifyContent: 'flex-start',
                                              gap: 6,
                                            }}
                                          >
                                            <ArrowUturnLeftIcon size={15} color={VARIANT_PERF_COLORS.reply.header} />
                                            <Text
                                              style={{
                                                flex: 1,
                                                minWidth: 0,
                                                color: VARIANT_PERF_COLORS.reply.header,
                                                fontSize: 11,
                                                textAlign: 'left',
                                                fontWeight: '600',
                                                ...variantPerfHeaderLabelWeb,
                                              }}
                                              numberOfLines={1}
                                            >
                                              Replied
                                            </Text>
                                          </View>
                                        </View>
                                        <View style={variantPerfCol}>
                                          <View
                                            style={{
                                              flexDirection: 'row',
                                              alignItems: 'center',
                                              justifyContent: 'flex-start',
                                              gap: 6,
                                            }}
                                          >
                                            <CheckCircleIcon size={15} color={VARIANT_PERF_COLORS.interested.header} />
                                            <Text
                                              style={{
                                                flex: 1,
                                                minWidth: 0,
                                                color: VARIANT_PERF_COLORS.interested.header,
                                                fontSize: 11,
                                                textAlign: 'left',
                                                fontWeight: '600',
                                                ...variantPerfHeaderLabelWeb,
                                              }}
                                              numberOfLines={1}
                                            >
                                              Interested
                                            </Text>
                                          </View>
                                        </View>
                                        <View style={{ ...variantPerfCol, paddingRight: 0 }}>
                                          <View
                                            style={{
                                              flexDirection: 'row',
                                              alignItems: 'center',
                                              justifyContent: 'flex-start',
                                              gap: 6,
                                            }}
                                          >
                                            <ExclamationTriangleIcon size={15} color={VARIANT_PERF_COLORS.bounce.header} />
                                            <Text
                                              style={{
                                                flex: 1,
                                                minWidth: 0,
                                                color: VARIANT_PERF_COLORS.bounce.header,
                                                fontSize: 11,
                                                textAlign: 'left',
                                                fontWeight: '600',
                                                ...variantPerfHeaderLabelWeb,
                                              }}
                                              numberOfLines={1}
                                            >
                                              Bounced
                                            </Text>
                                          </View>
                                        </View>
                                      </View>
                                      {variants.map((v, rowIndex) => {
                                        const counts = statLookup(variantStats, flowId, v.id);
                                        const cells = formatVariantPerfCells({
                                          priority: isPriorityEmail,
                                          counts,
                                        });
                                        const isLastRow = rowIndex === variants.length - 1;
                                        return (
                                          <View
                                            key={v.id}
                                            style={{
                                              flexDirection: 'row',
                                              flexWrap: 'nowrap',
                                              width: '100%',
                                              alignItems: 'center',
                                              paddingVertical: 10,
                                              paddingHorizontal: 12,
                                              opacity: v.isActive ? 1 : 0.55,
                                              ...(isLastRow
                                                ? {}
                                                : { borderBottomWidth: 1, borderBottomColor: '#1f1f1f' }),
                                            }}
                                          >
                                            <View style={variantPerfCol}>
                                              <Text
                                                style={{
                                                  color: VARIANT_PERF_COLORS.variant.cell,
                                                  fontSize: 14,
                                                  textAlign: 'left',
                                                  fontWeight: '600',
                                                }}
                                                numberOfLines={1}
                                                ellipsizeMode="tail"
                                              >
                                                {v.label}
                                                {!v.isActive ? ' (off)' : ''}
                                              </Text>
                                            </View>
                                            <View style={variantPerfCol}>
                                              <Text
                                                style={{
                                                  color: VARIANT_PERF_COLORS.sent.cell,
                                                  fontSize: 14,
                                                  textAlign: 'left',
                                                  fontWeight: '600',
                                                }}
                                              >
                                                {cells.sent}
                                              </Text>
                                            </View>
                                            <View style={variantPerfCol}>
                                              <VariantPerfStatText
                                                cell={cells.replied}
                                                color={VARIANT_PERF_COLORS.reply.cell}
                                              />
                                            </View>
                                            <View style={variantPerfCol}>
                                              <VariantPerfStatText
                                                cell={cells.interested}
                                                color={VARIANT_PERF_COLORS.interested.cell}
                                              />
                                            </View>
                                            <View style={{ ...variantPerfCol, paddingRight: 0 }}>
                                              <VariantPerfStatText
                                                cell={cells.bounced}
                                                color={VARIANT_PERF_COLORS.bounce.cell}
                                              />
                                            </View>
                                          </View>
                                        );
                                      })}
                                    </View>
                                  </View>
                                );
                              })}
                        </View>
                      )}
                    </View>
                  )}
                  <View style={{ borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingTop: 24, marginTop: 24 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                      <View>
                        <Text className="text-lg font-instrument-semibold text-white">
                          {statsGrain === 'day' ? 'Daily trends' : 'Weekly trends'}
                        </Text>
                        <Text className="text-sm text-neutral-400 font-instrument mt-1">
                          {campaign?.source === 'smartlead'
                            ? 'Imported from Smartlead'
                            : statsGrain === 'day'
                              ? 'Hover a day for exact counts.'
                              : 'Hover a week for exact counts.'}
                        </Text>
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
                    {statsByDayError ? (
                      <Text className="text-red-400 font-instrument text-sm mb-3">{statsByDayError}</Text>
                    ) : null}
                    <AccountTrendChart
                      categoryKind={statsGrain}
                      categories={trendLabels}
                      panels={trendPanels}
                      loading={statsByDayLoading}
                      embedded
                    />
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
                {leadRemoveBanner ? (
                  <Alert
                    variant={leadRemoveBanner.variant}
                    message={leadRemoveBanner.message}
                    className="mb-3"
                    actionText="Dismiss"
                    onAction={() => setLeadRemoveBanner(null)}
                  />
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
                  selectable={!isSmartlead}
                  selectedKeys={selectedLeadIds}
                  onSelectionChange={setSelectedLeadIds}
                  onFetchViewKeys={handleFetchLeadViewKeys}
                  headerSummary={
                    <Text className="text-gray-400 font-instrument text-sm">
                      {selectedLeadIds.size > 0
                        ? `${selectedLeadIds.size} selected`
                        : `${leadTotalCount} ${leadTotalCount === 1 ? 'lead' : 'leads'} match current filters`}
                    </Text>
                  }
                  headerActions={
                    <>
                      <View className="relative">
                        <IconButton
                          icon={FunnelIcon}
                          variant="secondary"
                          size="sm"
                          matchButtonPadding="sm"
                          accessibilityLabel="Open lead filters"
                          onPress={() => setLeadFiltersOpen(true)}
                        />
                        {activeLeadFilterCount > 0 ? (
                          <View className="absolute -top-1 -right-1 min-w-[18px] min-h-[18px] px-1 items-center justify-center rounded-full bg-brand-orange border border-[#1A1A1A]">
                            <Text className="text-white font-instrument-semibold text-[10px] leading-none">
                              {activeLeadFilterCount}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {Platform.OS === 'web' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="min-h-10"
                          disabled={exportingLeads || leadRowsLoading || (selectedLeadIds.size === 0 && leadTotalCount === 0)}
                          onPress={() => void handleExportLeads()}
                        >
                          {exportingLeads ? 'Exporting…' : selectedLeadIds.size > 0 ? 'Export selected' : 'Export'}
                        </Button>
                      ) : null}
                      {!isSmartlead && selectedLeadIds.size > 0 ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="min-h-10"
                          disabled={bulkRemovingLeads}
                          onPress={openLeadRemoveConfirm}
                        >
                          {bulkRemovingLeads ? 'Removing…' : 'Remove from campaign'}
                        </Button>
                      ) : null}
                    </>
                  }
                />
                <CampaignLeadFiltersModal
                  visible={leadFiltersOpen}
                  filters={leadFilters}
                  onChange={setLeadFilters}
                  onClose={() => setLeadFiltersOpen(false)}
                  onClear={() => setLeadFilters(EMPTY_CAMPAIGN_LEAD_FILTERS)}
                />
              </View>
            )}

            <View
              style={{
                display: activeTab === 'schedule' ? 'flex' : 'none',
                marginBottom: activeTab === 'schedule' ? 16 : 0,
              }}
            >
              {campaign ? (
                <ScheduleTab campaignId={id!} refreshTrigger={refreshKey} />
              ) : null}
            </View>
    </View>
  ) : null;

  const detailHeader = (
    <DetailPageShell
      breadcrumbItems={[
        { label: 'Campaigns', href: '/campaigns' },
        {
          label: showPlaceholder ? 'Campaign' : (campaign?.name ?? 'Campaign'),
        },
      ]}
      backHref="/campaigns"
      title={showPlaceholder ? 'Campaign' : (campaign?.name ?? 'Campaign')}
      mobileRightAction={
        showPlaceholder ? undefined : (
          <MobileHeaderButton
            variant="actions"
            onPress={() => setShowCampaignActionsSheet(true)}
            accessibilityLabel="Campaign actions"
          />
        )
      }
      actions={showPlaceholder ? undefined : headerActions}
      contentPadding={16}
    >
      {showPlaceholder ? <CampaignDetailSkeleton /> : null}
      {loadError && (
        <Alert variant="error" message={loadError} actionText="Retry" onAction={() => loadCampaign()} />
      )}
      {campaign && !showPlaceholder && !loadError && tabContent}
    </DetailPageShell>
  );

  return (
    <>
      {detailHeader}
      <ConfirmModal
        visible={leadRemoveConfirmOpen}
        onClose={() => setLeadRemoveConfirmOpen(false)}
        onConfirm={handleConfirmRemoveLeads}
        title="Remove leads from campaign?"
        message={`This will remove ${selectedLeadIds.size} lead(s) from this campaign and cancel pending sends. Sent emails and inbox history stay. If one lead fails, others may still be removed.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        confirmVariant="destructive"
      />
      <SmartleadRestrictedModal
        visible={showSmartleadRestrictedModal}
        onClose={() => setShowSmartleadRestrictedModal(false)}
        campaignId={id ?? null}
        isOnStatsPage={true}
      />
      <RenameCampaignModal
        visible={showRenameModal}
        campaign={campaign ? { id: campaign.id, name: campaign.name } : null}
        onClose={() => setShowRenameModal(false)}
        onRenamed={setCampaign}
      />
      <BottomSheet
        visible={showCampaignActionsSheet}
        onClose={() => setShowCampaignActionsSheet(false)}
        onAfterClose={handleCampaignActionsSheetAfterClose}
      >
        {statusMenuInActionsSheet}
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
        {/* Rename */}
        <Pressable
          onPress={() => {
            setShowRenameModal(true);
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
          <PencilIcon size={20} color="#9CA3AF" />
          <Text className="text-white font-instrument-medium text-base">Rename</Text>
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
      {showStatusMenu && (campaign?.status === 'running' || campaign?.status === 'paused') && !isSmartlead ? (
        <CampaignStatusActionsSheet
          visible={showStatusActionsSheet}
          onClose={() => setShowStatusActionsSheet(false)}
          {...statusMenuProps}
        />
      ) : null}
    </>
  );
}
