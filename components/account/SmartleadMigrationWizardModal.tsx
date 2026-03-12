import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { CheckIcon, ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from 'react-native-heroicons/outline';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/forms';
import { useAccount } from '@/contexts/AccountContext';
import {
  fetchSmartleadCampaigns,
  type CampaignMigrationResult,
  type ConversationImportDiagnostics,
  type MigrationProgress,
  type SmartleadCampaign,
} from '@/lib/smartlead/migration';
import {
  cancelSmartleadMigrationRun,
  createSmartleadMigrationRun,
  getActiveSmartleadMigrationRun,
  getSmartleadMigrationRun,
  listSmartleadMigrationCampaigns,
  listSmartleadMigrationEvents,
} from '@/lib/supabase/services/smartlead-migrations';
import {
  launchSmartleadMigrationTask,
  resumeSmartleadMigrationTask,
} from '@/lib/services/smartlead-migration-runner';
import { getLeads } from '@/lib/supabase/services/leads';
import { getLeadDisplayName } from '@/lib/leads';
import { getThreadsByAccount } from '@/lib/supabase/services/inbox';
import type {
  EmailThread,
  Lead,
  SmartleadMigrationCampaign,
  SmartleadMigrationEvent,
  SmartleadMigrationRun,
} from '@/lib/supabase/types';

const STEPS = ['API Key', 'Campaigns', 'Migrate'] as const;
const ACTIVE_RUN_STATUSES: SmartleadMigrationRun['status'][] = ['queued', 'launching', 'running', 'cancel_requested'];
const STALE_RUN_MS = 60_000;

type CampaignRow = { campaign: SmartleadCampaign; depth: number };

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  ACTIVE: { bg: 'bg-green-500/15', border: 'border-green-500/30', text: 'text-green-400' },
  COMPLETED: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', text: 'text-blue-400' },
  STOPPED: { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-400' },
  PAUSED: { bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-400' },
  DRAFTED: { bg: 'bg-gray-500/15', border: 'border-gray-500/25', text: 'text-gray-400' },
};
const DEFAULT_STATUS_STYLE = { bg: 'bg-gray-500/15', border: 'border-gray-500/25', text: 'text-gray-400' };

const campaignSelectionColumns: TableColumn<CampaignRow>[] = [
  {
    key: 'campaign',
    label: 'Campaign',
    flex: 1,
    minWidth: 180,
    render: (row) => (
      <View className="flex-row items-center">
        {row.depth === 1 && (
          <Text className="text-gray-600 text-sm mr-1.5">↳</Text>
        )}
        <Text
          className={`text-sm ${row.depth === 1 ? 'text-gray-300 font-instrument' : 'text-white font-instrument-medium'}`}
          numberOfLines={1}
        >
          {row.campaign.name || `Campaign #${row.campaign.id}`}
        </Text>
      </View>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    minWidth: 160,
    maxWidth: 160,
    render: (row) => {
      if (!row.campaign.status) return null;
      const s = STATUS_STYLES[row.campaign.status.toUpperCase()] ?? DEFAULT_STATUS_STYLE;
      return (
        <View className={`self-start px-2 py-0.5 rounded ${s.bg} border ${s.border}`}>
          <Text className={`text-xs font-instrument-medium capitalize ${s.text}`}>
            {row.campaign.status.toLowerCase()}
          </Text>
        </View>
      );
    },
  },
];

/** Short reason why 0 conversations were imported (for UI). */
function conversationZeroReason(d: ConversationImportDiagnostics | undefined): string | null {
  if (!d) return null;
  if (d.imported > 0) return null;
  if (d.repliedFromApi === 0) return 'no replies in Smartlead';
  if (d.leadsMatched === 0) return 'replies could not match to leads';
  if (d.skippedNoMatch > 0) return `${d.skippedNoMatch} no lead match`;
  if (d.skippedEmptyHistory > 0) return `${d.skippedEmptyHistory} empty history`;
  return null;
}

function MigrationCheckCell({ value }: { value: boolean }) {
  return (
    <View className="flex-1 items-center justify-center">
      {value ? (
        <View className="h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
          <CheckIcon size={12} color="#22c55e" />
        </View>
      ) : (
        <View className="h-5 w-5 items-center justify-center rounded-full bg-neutral-700/60">
          <XMarkIcon size={12} color="#6B7280" />
        </View>
      )}
    </View>
  );
}

const migrationResultColumns: TableColumn<CampaignMigrationResult>[] = [
  {
    key: 'campaign',
    label: 'Campaign',
    flex: 2,
    minWidth: 140,
    render: (r) => (
      <Text
        className={`text-sm font-instrument-medium ${r.status === 'succeeded' ? 'text-white' : 'text-red-300'}`}
        numberOfLines={1}
      >
        {r.campaignName}
      </Text>
    ),
  },
  {
    key: 'leads',
    label: 'Leads',
    minWidth: 72,
    maxWidth: 72,
    render: (r) => (
      <Text className="text-neutral-300 text-xs font-instrument text-center w-full">
        {r.status === 'succeeded' ? String(r.leadsImported ?? 0) : '—'}
      </Text>
    ),
  },
  {
    key: 'conversations',
    label: 'Conv',
    minWidth: 72,
    maxWidth: 72,
    render: (r) => {
      if (r.status !== 'succeeded') return <Text className="text-neutral-500 text-xs font-instrument text-center w-full">—</Text>;
      const count = r.conversationsImported ?? 0;
      const reason = conversationZeroReason(r.conversationDiagnostics);
      return (
        <View className="items-center justify-center w-full">
          <Text className="text-neutral-300 text-xs font-instrument">{String(count)}</Text>
          {count === 0 && reason && (
            <Text className="text-neutral-500 text-[10px] font-instrument mt-0.5" numberOfLines={1}>
              {reason}
            </Text>
          )}
        </View>
      );
    },
  },
  {
    key: 'totals',
    label: 'Totals',
    minWidth: 72,
    maxWidth: 72,
    render: (r) => (
      <MigrationCheckCell value={r.status === 'succeeded' ? (r.totalsStatsImported ?? false) : false} />
    ),
  },
  {
    key: 'daily',
    label: 'Daily',
    minWidth: 72,
    maxWidth: 72,
    render: (r) => (
      <MigrationCheckCell value={r.status === 'succeeded' ? (r.dayByDayStatsImported ?? false) : false} />
    ),
  },
  {
    key: 'notes',
    label: 'Error',
    flex: 3,
    minWidth: 120,
    render: (r) => (
      <Text
        className={`text-xs font-instrument ${r.status === 'failed' ? 'text-red-400/80' : 'text-neutral-600'}`}
        numberOfLines={2}
      >
        {r.status === 'failed' ? (r.error ?? '') : ''}
      </Text>
    ),
  },
];

const migrationStatsColumns: TableColumn<CampaignMigrationResult>[] = [
  migrationResultColumns[0],
  migrationResultColumns[3],
  migrationResultColumns[4],
];

const REVIEW_PAGE_SIZE = 25;

type ReviewSectionKey = 'campaigns' | 'leads' | 'conversations' | 'stats' | 'events';

type MigrationResultState = {
  succeeded: string[];
  failed: { name: string; error: string }[];
  statsImported?: boolean;
  totalLeadsImported?: number;
  campaignResults?: CampaignMigrationResult[];
};

type ReviewCampaignOption = {
  id: string;
  name: string;
  leadsImported: number;
  conversationsImported: number;
  totalsStatsImported: boolean;
  dayByDayStatsImported: boolean;
};

type ReviewSectionLayout = {
  y: number;
  height: number;
};

function mapRunToProgress(
  run: SmartleadMigrationRun | null,
): MigrationProgress | null {
  if (!run?.current_phase) return null;
  return {
    campaignIndex: Math.max(0, run.completed_campaign_count + run.failed_campaign_count),
    campaignCount: run.selected_campaign_count,
    campaignName: run.current_campaign_name ?? '',
    phase: run.current_phase,
    detail: run.current_detail ?? undefined,
  };
}

function mapCampaignRowToResult(
  row: SmartleadMigrationCampaign,
): CampaignMigrationResult {
  const diagnostics: ConversationImportDiagnostics | undefined = (
    row.replied_from_api > 0 ||
    row.leads_matched > 0 ||
    row.skipped_no_match > 0 ||
    row.skipped_empty_history > 0 ||
    row.conversations_imported > 0
  )
    ? {
        repliedFromApi: row.replied_from_api,
        leadsMatched: row.leads_matched,
        skippedNoMatch: row.skipped_no_match,
        skippedEmptyHistory: row.skipped_empty_history,
        imported: row.conversations_imported,
      }
    : undefined;

  return {
    campaignId: row.furnace_campaign_id ?? undefined,
    campaignName: row.campaign_name,
    status: row.status === 'succeeded' ? 'succeeded' : 'failed',
    error: row.last_error_message ?? (row.status === 'cancelled' ? 'Migration cancelled.' : undefined),
    leadsImported: row.leads_imported,
    conversationsImported: row.conversations_imported,
    conversationDiagnostics: diagnostics,
    totalsStatsImported: row.totals_stats_imported,
    dayByDayStatsImported: row.day_by_day_stats_imported,
  };
}

function buildResultState(
  run: SmartleadMigrationRun,
  campaignRows: SmartleadMigrationCampaign[],
): MigrationResultState {
  const campaignResults = campaignRows.map(mapCampaignRowToResult);
  const succeeded = campaignRows
    .filter((row) => row.status === 'succeeded')
    .map((row) => row.campaign_name);
  const failed = campaignRows
    .filter((row) => row.status === 'failed' || row.status === 'cancelled')
    .map((row) => ({
      name: row.campaign_name,
      error: row.last_error_message ?? (row.status === 'cancelled' ? 'Migration cancelled.' : 'Migration failed.'),
    }));

  return {
    succeeded,
    failed,
    statsImported: run.totals_stats_campaign_count > 0 || run.day_by_day_stats_campaign_count > 0,
    totalLeadsImported: run.leads_imported,
    campaignResults,
  };
}

function formatCount(value: number | null | undefined): string {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatParticipants(participants: string[] | null | undefined): string {
  if (!participants || participants.length === 0) return '—';
  if (participants.length <= 2) return participants.join(', ');
  return `${participants.slice(0, 2).join(', ')} +${participants.length - 2}`;
}

function ReviewSection({
  title,
  summary,
  expanded,
  onPress,
  children,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const chevronRotation = useSharedValue(expanded ? 180 : 0);
  const contentOpacity = useSharedValue(expanded ? 1 : 0);
  const contentTranslateY = useSharedValue(expanded ? 0 : -6);

  useEffect(() => {
    chevronRotation.value = withTiming(expanded ? 180 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });

    if (expanded) {
      contentOpacity.value = 0;
      contentTranslateY.value = -6;
      contentOpacity.value = withTiming(1, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      contentTranslateY.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [expanded, chevronRotation, contentOpacity, contentTranslateY]);

  const chevronAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  return (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] overflow-hidden">
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        className="px-4 py-4 flex-row items-center justify-between gap-3"
      >
        <View className="flex-1">
          <Text className="text-white text-sm font-instrument-medium">{title}</Text>
          <Text className="text-gray-400 text-xs font-instrument mt-1">{summary}</Text>
        </View>
        <View className="h-8 w-8 rounded-full bg-[#1F1F1F] border border-[#2A2A2A] items-center justify-center">
          <Animated.View style={chevronAnimatedStyle}>
            <ChevronDownIcon size={16} color="#9CA3AF" />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View className="px-4 pb-4 border-t border-[#2A2A2A] bg-[#111111]">
          <Animated.View className="pt-4" style={contentAnimatedStyle}>
            {children}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

function ReviewSectionPagination({
  page,
  pageSize,
  totalCount,
  itemCount,
  onPrevious,
  onNext,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  itemCount: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (totalCount <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(totalCount, page * pageSize + itemCount);
  const canPrevious = page > 0;
  const canNext = page + 1 < totalPages && itemCount > 0;

  return (
    <View className="flex-row items-center justify-between mt-3 px-1">
      <Button
        variant="secondary"
        size="sm"
        onPress={onPrevious}
        disabled={!canPrevious}
      >
        Previous
      </Button>

      <Text className="text-xs text-gray-400 font-instrument">
        {start}-{end} of {formatCount(totalCount)}
      </Text>

      <Button
        variant="secondary"
        size="sm"
        onPress={onNext}
        disabled={!canNext}
      >
        Next
      </Button>
    </View>
  );
}

const migrationLeadColumns: TableColumn<Lead>[] = [
  {
    key: 'email',
    label: 'Email',
    flex: 2,
    minWidth: 220,
    render: (lead) => (
      <Text className="text-sm text-white font-instrument-medium" numberOfLines={1}>
        {lead.email ?? '—'}
      </Text>
    ),
  },
  {
    key: 'name',
    label: 'Name',
    flex: 1.5,
    minWidth: 180,
    render: (lead) => (
      <Text className="text-xs text-neutral-300 font-instrument" numberOfLines={1}>
        {getLeadDisplayName(lead) || '—'}
      </Text>
    ),
  },
  {
    key: 'created',
    label: 'Imported',
    minWidth: 160,
    maxWidth: 160,
    render: (lead) => (
      <Text className="text-xs text-neutral-400 font-instrument" numberOfLines={1}>
        {formatDateTime(lead.created_at)}
      </Text>
    ),
  },
];

const migrationConversationColumns: TableColumn<EmailThread>[] = [
  {
    key: 'subject',
    label: 'Subject',
    flex: 2,
    minWidth: 220,
    render: (thread) => (
      <Text className="text-sm text-white font-instrument-medium" numberOfLines={1}>
        {thread.subject || 'No subject'}
      </Text>
    ),
  },
  {
    key: 'participants',
    label: 'Participants',
    flex: 1.5,
    minWidth: 220,
    render: (thread) => (
      <Text className="text-xs text-neutral-300 font-instrument" numberOfLines={1}>
        {formatParticipants(thread.participants)}
      </Text>
    ),
  },
  {
    key: 'lastMessage',
    label: 'Last Message',
    minWidth: 160,
    maxWidth: 160,
    render: (thread) => (
      <Text className="text-xs text-neutral-400 font-instrument" numberOfLines={1}>
        {formatDateTime(thread.last_message_at)}
      </Text>
    ),
  },
  {
    key: 'messageCount',
    label: 'Messages',
    minWidth: 84,
    maxWidth: 84,
    render: (thread) => (
      <Text className="text-xs text-neutral-300 font-instrument text-center w-full">
        {formatCount(thread.message_count)}
      </Text>
    ),
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SmartleadMigrationWizardModal({ visible, onClose }: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const { user, account } = useAccount();

  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [campaigns, setCampaigns] = useState<SmartleadCampaign[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<SmartleadMigrationRun | null>(null);
  const [runCampaignRows, setRunCampaignRows] = useState<SmartleadMigrationCampaign[]>([]);
  const [runEvents, setRunEvents] = useState<SmartleadMigrationEvent[]>([]);

  const campaignRows = useMemo((): CampaignRow[] => {
    if (campaigns.length === 0) return [];
    const campaignIds = new Set(campaigns.map((c) => c.id));
    const roots = campaigns.filter((c) => c.parent_campaign_id == null);
    const childrenByParent = new Map<number, SmartleadCampaign[]>();
    for (const c of campaigns) {
      if (c.parent_campaign_id != null && campaignIds.has(c.parent_campaign_id)) {
        const list = childrenByParent.get(c.parent_campaign_id) ?? [];
        list.push(c);
        childrenByParent.set(c.parent_campaign_id, list);
      }
    }
    const ordered: CampaignRow[] = [];
    for (const root of roots) {
      ordered.push({ campaign: root, depth: 0 });
      for (const child of childrenByParent.get(root.id) ?? []) {
        ordered.push({ campaign: child, depth: 1 });
      }
    }
    const orphans = campaigns.filter(
      (c) => c.parent_campaign_id != null && !campaignIds.has(c.parent_campaign_id!)
    );
    for (const o of orphans) {
      ordered.push({ campaign: o, depth: 0 });
    }
    return ordered;
  }, [campaigns]);

  const campaignSelectedKeys = useMemo(
    () => new Set([...selectedIds].map(String)),
    [selectedIds]
  );

  const filteredCampaignRows = useMemo(() => {
    if (!campaignSearchQuery.trim()) return campaignRows;
    const q = campaignSearchQuery.trim().toLowerCase();
    return campaignRows.filter((row) => {
      const name = (row.campaign.name || `Campaign #${row.campaign.id}`).toLowerCase();
      const status = (row.campaign.status ?? '').toLowerCase();
      return name.includes(q) || status.includes(q);
    });
  }, [campaignRows, campaignSearchQuery]);

  const [result, setResult] = useState<MigrationResultState | null>(null);
  const [expandedSection, setExpandedSection] = useState<ReviewSectionKey | null>(null);
  const [selectedLeadCampaignId, setSelectedLeadCampaignId] = useState<string | null>(null);
  const [leadPage, setLeadPage] = useState(0);
  const [leadRows, setLeadRows] = useState<Lead[]>([]);
  const [leadRowsLoading, setLeadRowsLoading] = useState(false);
  const [leadRowsError, setLeadRowsError] = useState<string | null>(null);
  const [selectedConversationCampaignId, setSelectedConversationCampaignId] = useState<string | null>(null);
  const [conversationPage, setConversationPage] = useState(0);
  const [conversationRows, setConversationRows] = useState<EmailThread[]>([]);
  const [conversationRowsLoading, setConversationRowsLoading] = useState(false);
  const [conversationRowsError, setConversationRowsError] = useState<string | null>(null);
  const resultsScrollRef = useRef<ScrollView | null>(null);
  const sectionLayoutsRef = useRef<Partial<Record<ReviewSectionKey, ReviewSectionLayout>>>({});
  const resultsFade = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      setStep(0);
      setApiKey('');
      setCampaigns([]);
      setSelectedIds(new Set());
      setCampaignSearchQuery('');
      setLoading(false);
      setError(null);
      setMigrating(false);
      setProgress(null);
      setRunId(null);
      setRun(null);
      setRunCampaignRows([]);
      setRunEvents([]);
      setResult(null);
      setExpandedSection(null);
      setSelectedLeadCampaignId(null);
      setLeadPage(0);
      setLeadRows([]);
      setLeadRowsLoading(false);
      setLeadRowsError(null);
      setSelectedConversationCampaignId(null);
      setConversationPage(0);
      setConversationRows([]);
      setConversationRowsLoading(false);
      setConversationRowsError(null);
      sectionLayoutsRef.current = {};
      resultsFade.value = 0;
    }
  }, [visible, resultsFade]);

  const isRunStale = useMemo(() => {
    if (!run?.last_heartbeat_at) return false;
    if (!ACTIVE_RUN_STATUSES.includes(run.status)) return false;
    return Date.now() - new Date(run.last_heartbeat_at).getTime() > STALE_RUN_MS;
  }, [run]);

  const refreshRunState = useCallback(async (targetRunId: string) => {
    const [nextRun, nextCampaignRows, nextEvents] = await Promise.all([
      getSmartleadMigrationRun(targetRunId),
      listSmartleadMigrationCampaigns(targetRunId),
      listSmartleadMigrationEvents(targetRunId, 40),
    ]);

    if (!nextRun) {
      throw new Error('Migration run no longer exists.');
    }

    setRun(nextRun);
    setRunCampaignRows(nextCampaignRows);
    setRunEvents(nextEvents);
    setProgress(mapRunToProgress(nextRun));

    const isActive = ACTIVE_RUN_STATUSES.includes(nextRun.status);
    setMigrating(isActive);
    setStep(2);

    if (!isActive) {
      setResult(buildResultState(nextRun, nextCampaignRows));
      setExpandedSection((current) => current ?? 'campaigns');
    } else {
      setResult(null);
    }
  }, []);

  useEffect(() => {
    if (!visible || !account?.id || runId) return;

    let cancelled = false;
    getActiveSmartleadMigrationRun(account.id)
      .then((activeRun) => {
        if (cancelled || !activeRun) return;
        setRunId(activeRun.id);
        setStep(2);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('Failed to restore Smartlead migration run:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [visible, account?.id, runId]);

  useEffect(() => {
    if (!visible || !runId) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        await refreshRunState(runId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to refresh migration status.');
        }
      }
    };

    void poll();

    intervalId = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [visible, runId, refreshRunState]);

  const reviewCampaignResults = result?.campaignResults ?? [];
  const reviewCampaignOptions = useMemo<ReviewCampaignOption[]>(
    () =>
      reviewCampaignResults
        .filter((campaign): campaign is CampaignMigrationResult & { campaignId: string } =>
          campaign.status === 'succeeded' && typeof campaign.campaignId === 'string' && campaign.campaignId.length > 0
        )
        .map((campaign) => ({
          id: campaign.campaignId,
          name: campaign.campaignName,
          leadsImported: campaign.leadsImported ?? 0,
          conversationsImported: campaign.conversationsImported ?? 0,
          totalsStatsImported: campaign.totalsStatsImported ?? false,
          dayByDayStatsImported: campaign.dayByDayStatsImported ?? false,
        })),
    [reviewCampaignResults]
  );

  const selectedLeadCampaign = useMemo(
    () => reviewCampaignOptions.find((campaign) => campaign.id === selectedLeadCampaignId) ?? null,
    [reviewCampaignOptions, selectedLeadCampaignId]
  );
  const selectedConversationCampaign = useMemo(
    () => reviewCampaignOptions.find((campaign) => campaign.id === selectedConversationCampaignId) ?? null,
    [reviewCampaignOptions, selectedConversationCampaignId]
  );

  const totalConversationsImported = useMemo(
    () => reviewCampaignResults.reduce((sum, campaign) => sum + (campaign.conversationsImported ?? 0), 0),
    [reviewCampaignResults]
  );
  const totalsStatsCampaignCount = useMemo(
    () => reviewCampaignResults.filter((campaign) => campaign.totalsStatsImported).length,
    [reviewCampaignResults]
  );
  const dayByDayStatsCampaignCount = useMemo(
    () => reviewCampaignResults.filter((campaign) => campaign.dayByDayStatsImported).length,
    [reviewCampaignResults]
  );

  const resultsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: resultsFade.value,
  }));

  useEffect(() => {
    if (reviewCampaignOptions.length === 0) {
      setSelectedLeadCampaignId(null);
      setSelectedConversationCampaignId(null);
      return;
    }

    if (!selectedLeadCampaignId || !reviewCampaignOptions.some((campaign) => campaign.id === selectedLeadCampaignId)) {
      setSelectedLeadCampaignId(reviewCampaignOptions[0].id);
      setLeadPage(0);
    }

    if (
      !selectedConversationCampaignId ||
      !reviewCampaignOptions.some((campaign) => campaign.id === selectedConversationCampaignId)
    ) {
      setSelectedConversationCampaignId(reviewCampaignOptions[0].id);
      setConversationPage(0);
    }
  }, [reviewCampaignOptions, selectedLeadCampaignId, selectedConversationCampaignId]);

  useEffect(() => {
    if (expandedSection !== 'leads' || !selectedLeadCampaign?.id) {
      if (expandedSection !== 'leads') {
        setLeadRows([]);
        setLeadRowsLoading(false);
        setLeadRowsError(null);
      }
      return;
    }

    let cancelled = false;
    setLeadRowsLoading(true);
    setLeadRowsError(null);

    getLeads({
      campaignId: selectedLeadCampaign.id,
      limit: REVIEW_PAGE_SIZE,
      offset: leadPage * REVIEW_PAGE_SIZE,
    })
      .then((rows) => {
        if (!cancelled) setLeadRows(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLeadRows([]);
          setLeadRowsError(err instanceof Error ? err.message : 'Failed to load imported leads.');
        }
      })
      .finally(() => {
        if (!cancelled) setLeadRowsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expandedSection, selectedLeadCampaign, leadPage]);

  useEffect(() => {
    if (expandedSection !== 'conversations' || !selectedConversationCampaign?.id || !account?.id) {
      if (expandedSection !== 'conversations') {
        setConversationRows([]);
        setConversationRowsLoading(false);
        setConversationRowsError(null);
      }
      return;
    }

    let cancelled = false;
    setConversationRowsLoading(true);
    setConversationRowsError(null);

    getThreadsByAccount(account.id, {
      campaignId: selectedConversationCampaign.id,
      limit: REVIEW_PAGE_SIZE,
      offset: conversationPage * REVIEW_PAGE_SIZE,
    })
      .then((rows) => {
        if (!cancelled) setConversationRows(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConversationRows([]);
          setConversationRowsError(err instanceof Error ? err.message : 'Failed to load imported conversations.');
        }
      })
      .finally(() => {
        if (!cancelled) setConversationRowsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expandedSection, selectedConversationCampaign, conversationPage, account]);

  useEffect(() => {
    if (!result || (result.campaignResults?.length ?? 0) === 0) {
      resultsFade.value = 0;
      return;
    }

    resultsFade.value = 0;
    const timeoutId = setTimeout(() => {
      resultsFade.value = withTiming(1, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      resultsScrollRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [result, resultsFade]);

  useEffect(() => {
    if (!expandedSection) return;

    const timeoutId = setTimeout(() => {
      const layout = sectionLayoutsRef.current[expandedSection];
      if (!layout) return;
      resultsScrollRef.current?.scrollTo({
        y: Math.max(0, layout.y - 24),
        animated: true,
      });
    }, 120);

    return () => clearTimeout(timeoutId);
  }, [expandedSection]);

  const handleFetchCampaigns = useCallback(async () => {
    setStep(1);
    setLoading(true);
    setError(null);
    setCampaigns([]);
    setSelectedIds(new Set());
    try {
      const list = await fetchSmartleadCampaigns(apiKey.trim());
      setCampaigns(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch campaigns.');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const handleBack = useCallback(() => {
    if (step === 1) {
      setStep(0);
      setCampaigns([]);
      setSelectedIds(new Set());
      setError(null);
    }
  }, [step]);

  const toggleCampaign = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === campaigns.length) return new Set();
      return new Set(campaigns.map((c) => c.id));
    });
  }, [campaigns]);

  const handleMigrate = useCallback(async () => {
    if (!account || !user) return;
    const selected = campaigns.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) return;

    setStep(2);
    setMigrating(true);
    setRun(null);
    setRunCampaignRows([]);
    setRunEvents([]);
    setResult(null);
    setError(null);
    setExpandedSection(null);
    setSelectedLeadCampaignId(null);
    setLeadPage(0);
    setLeadRows([]);
    setLeadRowsError(null);
    setSelectedConversationCampaignId(null);
    setConversationPage(0);
    setConversationRows([]);
    setConversationRowsError(null);

    try {
      const nextRunId = await createSmartleadMigrationRun({
        accountId: account.id,
        selectedCampaigns: selected,
      });
      setRunId(nextRunId);
      await launchSmartleadMigrationTask({
        runId: nextRunId,
        accountId: account.id,
        apiKey: apiKey.trim(),
      });
      await refreshRunState(nextRunId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Migration failed.');
      setMigrating(false);
    }
  }, [apiKey, campaigns, selectedIds, account, user, refreshRunState]);

  const handleCancelRun = useCallback(async () => {
    if (!runId) return;
    try {
      await cancelSmartleadMigrationRun(runId);
      await refreshRunState(runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to cancel migration.');
    }
  }, [runId, refreshRunState]);

  const handleResumeRun = useCallback(async () => {
    if (!runId || !account?.id) return;
    try {
      await resumeSmartleadMigrationTask({
        runId,
        accountId: account.id,
      });
      await refreshRunState(runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to resume migration.');
    }
  }, [runId, account?.id, refreshRunState]);

  const handleRetryFailed = useCallback(async () => {
    if (!account || !apiKey.trim()) return;

    const failedCampaigns = runCampaignRows
      .filter((row) => row.status === 'failed' || row.status === 'cancelled')
      .map((row) => ({
        id: row.smartlead_campaign_id,
        name: row.campaign_name,
        created_at: row.smartlead_created_at ?? undefined,
      }));

    if (failedCampaigns.length === 0) return;

    setError(null);
    setExpandedSection(null);
    setResult(null);
    setRun(null);
    setRunCampaignRows([]);
    setRunEvents([]);
    setProgress(null);
    setMigrating(true);

    try {
      const nextRunId = await createSmartleadMigrationRun({
        accountId: account.id,
        selectedCampaigns: failedCampaigns,
      });
      setRunId(nextRunId);
      await launchSmartleadMigrationTask({
        runId: nextRunId,
        accountId: account.id,
        apiKey: apiKey.trim(),
      });
      await refreshRunState(nextRunId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to retry failed campaigns.');
      setMigrating(false);
    }
  }, [account, apiKey, runCampaignRows, refreshRunState]);

  const canNext = step === 0 && apiKey.trim().length > 0;
  const canMigrate = step === 1 && selectedIds.size > 0 && !loading;
  const canRetryFailed = !migrating && runCampaignRows.some((row) => row.status === 'failed' || row.status === 'cancelled') && apiKey.trim().length > 0;
  const campaignSummary = `${formatCount(reviewCampaignResults.length)} migrated (${formatCount(result?.succeeded.length)} succeeded, ${formatCount(result?.failed.length)} failed)`;
  const leadsSummary = `${formatCount(result?.totalLeadsImported)} leads imported`;
  const conversationsSummary = `${formatCount(totalConversationsImported)} conversations imported`;
  const statsSummary = `${formatCount(totalsStatsCampaignCount)} totals, ${formatCount(dayByDayStatsCampaignCount)} daily`;
  const eventsSummary = `${formatCount(runEvents.length)} recent events`;

  const storeSectionLayout = useCallback((section: ReviewSectionKey, y: number, height: number) => {
    sectionLayoutsRef.current[section] = { y, height };
  }, []);

  const toggleReviewSection = useCallback((section: ReviewSectionKey) => {
    setExpandedSection((current) => (current === section ? null : section));
  }, []);

  const footer = (
    <View className="flex-row items-center justify-between">
      <View>
        {step === 1 && !migrating && (
          <TouchableOpacity
            onPress={handleBack}
            disabled={loading}
            style={{
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: loading ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)',
              opacity: loading ? 0.5 : 1,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
              Back
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View className="flex-row items-center gap-2">
        {step === 0 && (
          <Button onPress={handleFetchCampaigns} disabled={!canNext}>
            Next
          </Button>
        )}
        {step === 1 && (
          <Button onPress={handleMigrate} disabled={!canMigrate}>
            Start Background Migration ({selectedIds.size})
          </Button>
        )}
        {step === 2 && migrating && (
          <>
            {isRunStale ? (
              <Button onPress={handleResumeRun} variant="secondary">
                Resume Task
              </Button>
            ) : null}
            <Button onPress={handleCancelRun} variant="secondary">
              Cancel Run
            </Button>
          </>
        )}
        {step === 2 && !migrating && canRetryFailed && (
          <Button onPress={handleRetryFailed} variant="secondary">
            Retry Failed
          </Button>
        )}
        {step === 2 && !migrating && (
          <Button onPress={onClose} variant="secondary">
            Close
          </Button>
        )}
      </View>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Smartlead Migration"
      description="Import your campaigns and leads from Smartlead"
      footer={footer}
      maxWidth="4xl"
      maxHeight={Math.round(windowHeight * 0.75)}
    >
      <View className="gap-6" style={{ flex: 1 }}>
        {/* Step indicator */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          {STEPS.map((label, index) => {
            const isActive = index === step;
            const isComplete = index < step;
            return (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ alignItems: 'center', minWidth: 88 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isActive
                        ? '#F3440D'
                        : isComplete
                          ? 'rgba(243,68,13,0.4)'
                          : 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>
                      {index + 1}
                    </Text>
                  </View>
                  <Text
                    style={{
                      marginTop: 6,
                      color: isActive ? '#FFFFFF' : '#9CA3AF',
                      fontSize: 11,
                      fontFamily: 'Instrument Sans, system-ui, sans-serif',
                      fontWeight: isActive ? '600' : '500',
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      textAlign: 'center',
                    }}
                  >
                    {label}
                  </Text>
                </View>
                {index < STEPS.length - 1 && (
                  <View
                    style={{
                      width: 40,
                      height: 1,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      marginHorizontal: 8,
                    }}
                  />
                )}
              </View>
            );
          })}
        </View>

        {/* Step 0: API Key */}
        {step === 0 && (
          <View className="gap-4">
            <View>
              <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                Smartlead API Key
              </Text>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Enter your Smartlead API key"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                className="border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white"
                style={{
                  borderColor: '#3A3A3A',
                  backgroundColor: '#121212',
                  color: '#FFFFFF',
                  borderWidth: 1,
                }}
              />
              <Text className="text-xs text-gray-500 mt-2">
                Find your API key in Smartlead under Settings. Your key is only used for this session and is not stored.
              </Text>
              <View className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <Text className="text-amber-200 text-sm font-instrument">
                  Anything you import here will be added to the account you are currently viewing. If you manage multiple accounts, make sure you only import the campaigns that belong to that account so they are assigned correctly.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Step 1: Campaign list with selection */}
        {step === 1 && (
          <View style={{ flex: 1 }}>
            {loading && (
              <View className="items-center justify-center py-12">
                <ActivityIndicator size="large" color="#F3440D" />
                <Text className="text-gray-400 font-instrument mt-4">
                  Loading campaigns from Smartlead...
                </Text>
              </View>
            )}

            {error && !loading && (
              <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <Text className="text-red-400 text-sm font-instrument">{error}</Text>
              </View>
            )}

            {!loading && !error && campaigns.length === 0 && (
              <View className="items-center py-12">
                <Text className="text-gray-400 text-sm font-instrument">
                  No campaigns found in your Smartlead account.
                </Text>
              </View>
            )}

            {!loading && !error && campaigns.length > 0 && (
              <View style={{ flex: 1 }}>
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-xs text-gray-400 font-instrument-medium">
                    Campaigns ({campaigns.length}) — sub-campaigns nested under parents
                  </Text>
                  <Button variant="link" onPress={toggleAll} className="self-start">
                    {selectedIds.size === campaigns.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </View>
                <View className="flex-row items-center rounded-lg border border-[#2A2A2A] bg-[#121212] px-3 py-2 mb-3">
                  <MagnifyingGlassIcon size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
                  <TextInput
                    value={campaignSearchQuery}
                    onChangeText={setCampaignSearchQuery}
                    placeholder="Search campaigns by name or status..."
                    placeholderTextColor="#9CA3AF"
                    className="flex-1 text-sm text-white font-instrument"
                    style={{ paddingVertical: 4 }}
                  />
                </View>
                <View style={{ flex: 1, minHeight: 280 }}>
                  <DataTable<CampaignRow>
                    items={filteredCampaignRows}
                    getItemKey={(row) => String(row.campaign.id)}
                    columns={campaignSelectionColumns}
                    selectable
                    selectedKeys={campaignSelectedKeys}
                    onSelectionChange={(keys) => setSelectedIds(new Set(Array.from(keys).map(Number)))}
                    pagination
                    itemsPerPage={25}
                    compactHeader
                    emptyMessage={
                      campaignSearchQuery.trim()
                        ? 'No campaigns match your search'
                        : 'No campaigns'
                    }
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {/* Step 2: Migration progress / results */}
        {step === 2 && (
          <View className="gap-4" style={{ flex: 1 }}>
            {error && (
              <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <Text className="text-red-400 text-sm font-instrument">{error}</Text>
              </View>
            )}

            {run && (
              <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4 gap-4">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text className="text-white text-sm font-instrument-medium">
                      {migrating ? 'Migration Running' : 'Migration Complete'}
                    </Text>
                    <Text className="text-gray-400 text-xs font-instrument mt-1">
                      {formatCount(run.completed_campaign_count + run.failed_campaign_count)} of {formatCount(run.selected_campaign_count)} campaigns processed
                    </Text>
                  </View>
                  <View className="px-2.5 py-1 rounded-full border border-[#2A2A2A] bg-[#1B1B1B]">
                    <Text className="text-xs text-gray-300 font-instrument-medium capitalize">
                      {run.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>

                <View className="h-2 rounded-full bg-[#1F1F1F] overflow-hidden">
                  <View
                    style={{
                      width: `${run.selected_campaign_count > 0
                        ? Math.min(
                            100,
                            ((run.completed_campaign_count + run.failed_campaign_count) / run.selected_campaign_count) * 100,
                          )
                        : 0}%`,
                      height: '100%',
                      backgroundColor: '#F3440D',
                    }}
                  />
                </View>

                {progress ? (
                  <View className="gap-1">
                    <Text className="text-white text-sm font-instrument-medium">
                      {progress.campaignName || 'Waiting for task...'}
                    </Text>
                    <Text className="text-gray-400 text-xs font-instrument">
                      {progress.phase === 'campaign' && 'Creating campaign...'}
                      {progress.phase === 'leads' && 'Fetching and importing leads...'}
                      {progress.phase === 'enrollments' && `Creating enrollments (${progress.leadCount ?? 0} leads)...`}
                      {progress.phase === 'conversations' && (progress.detail ?? 'Importing conversations...')}
                      {progress.phase === 'stats' && 'Importing stats...'}
                      {progress.phase === 'done' && (run.current_detail ?? 'Migration finished.')}
                    </Text>
                  </View>
                ) : null}

                <View className="flex-row flex-wrap gap-4">
                  <View>
                    <Text className="text-[11px] uppercase tracking-wide text-gray-500 font-instrument-medium">Leads</Text>
                    <Text className="text-white text-sm font-instrument-medium">{formatCount(run.leads_imported)}</Text>
                  </View>
                  <View>
                    <Text className="text-[11px] uppercase tracking-wide text-gray-500 font-instrument-medium">Conversations</Text>
                    <Text className="text-white text-sm font-instrument-medium">{formatCount(run.conversations_imported)}</Text>
                  </View>
                  <View>
                    <Text className="text-[11px] uppercase tracking-wide text-gray-500 font-instrument-medium">Stats</Text>
                    <Text className="text-white text-sm font-instrument-medium">
                      {formatCount(run.totals_stats_campaign_count)} totals / {formatCount(run.day_by_day_stats_campaign_count)} daily
                    </Text>
                  </View>
                </View>

                {run.last_error_message ? (
                  <View className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <Text className="text-red-400 text-xs font-instrument">{run.last_error_message}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {migrating && !run && progress && (
              <View className="items-center justify-center py-12 gap-4">
                <ActivityIndicator size="large" color="#F3440D" />
                <Text className="text-white text-sm font-instrument-medium">
                  Preparing background migration...
                </Text>
              </View>
            )}

            {runEvents.length > 0 && (
              <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-white text-sm font-instrument-medium">Recent Activity</Text>
                  <Text className="text-gray-500 text-xs font-instrument">{eventsSummary}</Text>
                </View>
                <ScrollView style={{ maxHeight: Math.round(windowHeight * 0.18) }} showsVerticalScrollIndicator>
                  <View className="gap-2">
                    {runEvents.map((event) => (
                      <View key={event.id} className="rounded-lg border border-[#232323] bg-[#101010] px-3 py-2">
                        <View className="flex-row items-center justify-between gap-3">
                          <Text
                            className={`text-xs font-instrument-medium ${
                              event.level === 'error'
                                ? 'text-red-400'
                                : event.level === 'warning'
                                  ? 'text-amber-300'
                                  : 'text-white'
                            }`}
                          >
                            {event.detail ?? event.event_type.replace(/_/g, ' ')}
                          </Text>
                          <Text className="text-[10px] text-gray-500 font-instrument">
                            {formatDateTime(event.created_at)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {!migrating && result && (result.campaignResults?.length ?? 0) > 0 && (
              <Animated.View style={resultsAnimatedStyle}>
                <ScrollView
                  ref={resultsScrollRef}
                  style={{ maxHeight: Math.round(windowHeight * 0.42) }}
                  showsVerticalScrollIndicator
                  contentContainerStyle={{ gap: 12 }}
                >
                  <View
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      storeSectionLayout('campaigns', y, height);
                    }}
                  >
                    <ReviewSection
                      title="Campaigns"
                      summary={campaignSummary}
                      expanded={expandedSection === 'campaigns'}
                      onPress={() => toggleReviewSection('campaigns')}
                    >
                      <DataTable<CampaignMigrationResult>
                        items={reviewCampaignResults}
                        getItemKey={(r) =>
                          `${r.campaignId ?? 'none'}-${r.campaignName}-${r.totalsStatsImported}-${r.dayByDayStatsImported}`
                        }
                        pagination={false}
                        compactHeader
                        emptyMessage="No results"
                        columns={migrationResultColumns}
                      />
                    </ReviewSection>
                  </View>

                  <View
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      storeSectionLayout('leads', y, height);
                    }}
                  >
                    <ReviewSection
                      title="Leads"
                      summary={leadsSummary}
                      expanded={expandedSection === 'leads'}
                      onPress={() => toggleReviewSection('leads')}
                    >
                      {reviewCampaignOptions.length === 0 ? (
                        <Text className="text-sm text-gray-400 font-instrument">
                          No successful campaigns are available for lead review.
                        </Text>
                      ) : (
                        <View className="gap-3">
                          <Select<ReviewCampaignOption>
                            items={reviewCampaignOptions}
                            getItemId={(campaign) => campaign.id}
                            getItemLabel={(campaign) => ({
                              primary: campaign.name,
                              secondary: `${formatCount(campaign.leadsImported)} leads imported`,
                            })}
                            value={selectedLeadCampaign?.id ?? null}
                            onChange={(id) => {
                              setSelectedLeadCampaignId(id);
                              setLeadPage(0);
                            }}
                            label="Campaign"
                            placeholder="Select a migrated campaign"
                            searchable={false}
                            size="compact"
                          />

                          {leadRowsError ? (
                            <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                              <Text className="text-red-400 text-sm font-instrument">{leadRowsError}</Text>
                            </View>
                          ) : null}

                          <DataTable<Lead>
                            items={leadRows}
                            getItemKey={(lead) => lead.id}
                            pagination={false}
                            compactHeader
                            loading={leadRowsLoading}
                            emptyMessage={
                              selectedLeadCampaign
                                ? `No imported leads found for ${selectedLeadCampaign.name}.`
                                : 'No imported leads found.'
                            }
                            columns={migrationLeadColumns}
                          />

                          {selectedLeadCampaign ? (
                            <ReviewSectionPagination
                              page={leadPage}
                              pageSize={REVIEW_PAGE_SIZE}
                              totalCount={selectedLeadCampaign.leadsImported}
                              itemCount={leadRows.length}
                              onPrevious={() => setLeadPage((page) => Math.max(0, page - 1))}
                              onNext={() => setLeadPage((page) => page + 1)}
                            />
                          ) : null}
                        </View>
                      )}
                    </ReviewSection>
                  </View>

                  <View
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      storeSectionLayout('conversations', y, height);
                    }}
                  >
                    <ReviewSection
                      title="Conversations"
                      summary={conversationsSummary}
                      expanded={expandedSection === 'conversations'}
                      onPress={() => toggleReviewSection('conversations')}
                    >
                      {reviewCampaignOptions.length === 0 ? (
                        <Text className="text-sm text-gray-400 font-instrument">
                          No successful campaigns are available for conversation review.
                        </Text>
                      ) : (
                        <View className="gap-3">
                          <Select<ReviewCampaignOption>
                            items={reviewCampaignOptions}
                            getItemId={(campaign) => campaign.id}
                            getItemLabel={(campaign) => ({
                              primary: campaign.name,
                              secondary: `${formatCount(campaign.conversationsImported)} conversations imported`,
                            })}
                            value={selectedConversationCampaign?.id ?? null}
                            onChange={(id) => {
                              setSelectedConversationCampaignId(id);
                              setConversationPage(0);
                            }}
                            label="Campaign"
                            placeholder="Select a migrated campaign"
                            searchable={false}
                            size="compact"
                          />

                          {conversationRowsError ? (
                            <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                              <Text className="text-red-400 text-sm font-instrument">{conversationRowsError}</Text>
                            </View>
                          ) : null}

                          <DataTable<EmailThread>
                            items={conversationRows}
                            getItemKey={(thread) => thread.id}
                            pagination={false}
                            compactHeader
                            loading={conversationRowsLoading}
                            emptyMessage={
                              selectedConversationCampaign
                                ? `No imported conversations found for ${selectedConversationCampaign.name}.`
                                : 'No imported conversations found.'
                            }
                            columns={migrationConversationColumns}
                          />

                          {selectedConversationCampaign ? (
                            <ReviewSectionPagination
                              page={conversationPage}
                              pageSize={REVIEW_PAGE_SIZE}
                              totalCount={selectedConversationCampaign.conversationsImported}
                              itemCount={conversationRows.length}
                              onPrevious={() => setConversationPage((page) => Math.max(0, page - 1))}
                              onNext={() => setConversationPage((page) => page + 1)}
                            />
                          ) : null}
                        </View>
                      )}
                    </ReviewSection>
                  </View>

                  <View
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      storeSectionLayout('events', y, height);
                    }}
                  >
                    <ReviewSection
                      title="Events"
                      summary={eventsSummary}
                      expanded={expandedSection === 'events'}
                      onPress={() => toggleReviewSection('events')}
                    >
                      {runEvents.length === 0 ? (
                        <Text className="text-sm text-gray-400 font-instrument">
                          No event history is available for this run.
                        </Text>
                      ) : (
                        <View className="gap-2">
                          {runEvents.map((event) => (
                            <View key={event.id} className="rounded-lg border border-[#232323] bg-[#101010] px-3 py-3">
                              <View className="flex-row items-center justify-between gap-3">
                                <Text
                                  className={`text-xs font-instrument-medium ${
                                    event.level === 'error'
                                      ? 'text-red-400'
                                      : event.level === 'warning'
                                        ? 'text-amber-300'
                                        : 'text-white'
                                  }`}
                                >
                                  {event.detail ?? event.event_type.replace(/_/g, ' ')}
                                </Text>
                                <Text className="text-[10px] text-gray-500 font-instrument">
                                  {formatDateTime(event.created_at)}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </ReviewSection>
                  </View>

                  <View
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      storeSectionLayout('stats', y, height);
                    }}
                  >
                    <ReviewSection
                      title="Stats"
                      summary={statsSummary}
                      expanded={expandedSection === 'stats'}
                      onPress={() => toggleReviewSection('stats')}
                    >
                      <DataTable<CampaignMigrationResult>
                        items={reviewCampaignResults.filter((campaign) => campaign.status === 'succeeded')}
                        getItemKey={(campaign) => `${campaign.campaignId ?? 'none'}-${campaign.campaignName}-stats`}
                        pagination={false}
                        compactHeader
                        emptyMessage="No stats were imported."
                        columns={migrationStatsColumns}
                      />
                    </ReviewSection>
                  </View>
                </ScrollView>
              </Animated.View>
            )}
          </View>
        )}
      </View>
    </BaseModal>
  );
}
