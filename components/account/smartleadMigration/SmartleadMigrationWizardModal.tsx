import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { WizardStepIndicator } from '@/components/ui/wizard';
import { Button } from '@/components/ui/button';
import { useAccount } from '@/contexts/AccountContext';
import {
  fetchSmartleadCampaigns,
  type CampaignMigrationResult,
  type MigrationProgress,
  type SmartleadCampaign,
} from '@/lib/smartlead/migration';
import { launchSmartleadMigrationTask } from '@/lib/services/smartlead-migration-runner';
import { getThreadsByAccount } from '@/lib/supabase/services/inbox';
import { getLeads } from '@/lib/supabase/services/leads';
import {
  cancelSmartleadMigrationRun,
  createSmartleadMigrationRun,
  getActiveSmartleadMigrationRun,
  getSmartleadMigrationRun,
  listSmartleadMigrationCampaigns,
  listSmartleadMigrationEvents,
} from '@/lib/supabase/services/smartlead-migrations';
import type {
  EmailThread,
  Lead,
  SmartleadMigrationCampaign,
  SmartleadMigrationEvent,
  SmartleadMigrationRun,
} from '@/lib/supabase/types';
import { CLOSE_RESET_DELAY_MS, ACTIVE_RUN_STATUSES, REVIEW_PAGE_SIZE, STEPS } from './constants';
import { ApiKeyStep } from './components/ApiKeyStep';
import { CampaignSelectionStep } from './components/CampaignSelectionStep';
import { MigrationProgressStep } from './components/MigrationProgressStep';
import { MigrationReviewStep } from './components/MigrationReviewStep';
import {
  MigrationBootstrapSkeleton,
  MigrationStepIndicatorSkeleton,
} from './components/Skeletons';
import type {
  CampaignRow,
  MigrationResultState,
  ReviewCampaignOption,
  ReviewTabKey,
  WizardStep,
} from './types';
import { buildResultState, conversationZeroReason, formatCount, mapRunToProgress } from './utils';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialRunId?: string | null;
}

export function SmartleadMigrationWizardModal({ visible, onClose, initialRunId = null }: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const { user, account } = useAccount();

  const [step, setStep] = useState<WizardStep | undefined>();
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
    const campaignIds = new Set(campaigns.map((campaign) => campaign.id));
    const roots = campaigns.filter((campaign) => campaign.parent_campaign_id == null);
    const childrenByParent = new Map<number, SmartleadCampaign[]>();

    for (const campaign of campaigns) {
      if (campaign.parent_campaign_id != null && campaignIds.has(campaign.parent_campaign_id)) {
        const list = childrenByParent.get(campaign.parent_campaign_id) ?? [];
        list.push(campaign);
        childrenByParent.set(campaign.parent_campaign_id, list);
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
      (campaign) => campaign.parent_campaign_id != null && !campaignIds.has(campaign.parent_campaign_id),
    );
    for (const orphan of orphans) {
      ordered.push({ campaign: orphan, depth: 0 });
    }

    return ordered;
  }, [campaigns]);

  const campaignSelectedKeys = useMemo(() => new Set([...selectedIds].map(String)), [selectedIds]);

  const filteredCampaignRows = useMemo(() => {
    if (!campaignSearchQuery.trim()) return campaignRows;
    const query = campaignSearchQuery.trim().toLowerCase();
    return campaignRows.filter((row) => {
      const name = (row.campaign.name || `Campaign #${row.campaign.id}`).toLowerCase();
      const status = (row.campaign.status ?? '').toLowerCase();
      return name.includes(query) || status.includes(query);
    });
  }, [campaignRows, campaignSearchQuery]);

  const [result, setResult] = useState<MigrationResultState | null>(null);
  const [activeReviewTab, setActiveReviewTab] = useState<ReviewTabKey>('summary');
  const [selectedReviewCampaignId, setSelectedReviewCampaignId] = useState<string | null>(null);
  const [leadPage, setLeadPage] = useState(0);
  const [leadRows, setLeadRows] = useState<Lead[]>([]);
  const [leadRowsLoading, setLeadRowsLoading] = useState(false);
  const [leadRowsError, setLeadRowsError] = useState<string | null>(null);
  const [conversationPage, setConversationPage] = useState(0);
  const [conversationRows, setConversationRows] = useState<EmailThread[]>([]);
  const [conversationRowsLoading, setConversationRowsLoading] = useState(false);
  const [conversationRowsError, setConversationRowsError] = useState<string | null>(null);
  const closeResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetModalState = useCallback(
    ({
      preserveApiKey = false,
      step: nextStep,
    }: { preserveApiKey?: boolean; step?: WizardStep } = {}) => {
      setStep(nextStep);
      if (!preserveApiKey) {
        setApiKey('');
      }
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
      setActiveReviewTab('summary');
      setSelectedReviewCampaignId(null);
      setLeadPage(0);
      setLeadRows([]);
      setLeadRowsLoading(false);
      setLeadRowsError(null);
      setConversationPage(0);
      setConversationRows([]);
      setConversationRowsLoading(false);
      setConversationRowsError(null);
    },
    [],
  );

  useEffect(() => {
    if (closeResetTimeoutRef.current) {
      clearTimeout(closeResetTimeoutRef.current);
      closeResetTimeoutRef.current = null;
    }

    if (!visible) {
      closeResetTimeoutRef.current = setTimeout(() => {
        resetModalState();
        closeResetTimeoutRef.current = null;
      }, CLOSE_RESET_DELAY_MS);
      return;
    }

    let cancelled = false;
    resetModalState();

    if (initialRunId) {
      setRunId(initialRunId);
      setStep(2);
      return;
    }

    if (!account?.id) {
      setStep(0);
      return;
    }

    getActiveSmartleadMigrationRun(account.id)
      .then((activeRun) => {
        if (cancelled) return;

        if (activeRun) {
          setRunId(activeRun.id);
          setStep(2);
          return;
        }

        setStep(0);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('Failed to restore Smartlead migration run:', err);
          setStep(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [visible, account?.id, initialRunId, resetModalState]);

  useEffect(() => {
    return () => {
      if (closeResetTimeoutRef.current) {
        clearTimeout(closeResetTimeoutRef.current);
      }
    };
  }, []);

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
    setStep(isActive ? 2 : 3);

    if (!isActive) {
      setResult(buildResultState(nextRun, nextCampaignRows));
    } else {
      setResult(null);
    }
    return { run: nextRun, isActive };
  }, []);

  useEffect(() => {
    if (!visible || !runId) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = async () => {
      try {
        const nextState = await refreshRunState(runId);
        if (!cancelled && !nextState.isActive) {
          stopPolling();
        }
        return nextState;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to refresh migration status.');
        }
        return null;
      }
    };

    void poll().then((nextState) => {
      if (cancelled || !nextState?.isActive || intervalId) return;
      intervalId = setInterval(() => {
        void poll();
      }, 2000);
    });

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [visible, runId, refreshRunState]);

  const reviewCampaignResults = useMemo(() => result?.campaignResults ?? [], [result]);
  const reviewCampaignOptions = useMemo<ReviewCampaignOption[]>(
    () =>
      reviewCampaignResults
        .filter((campaign): campaign is CampaignMigrationResult & { campaignId: string; campaignRowId: string } =>
          campaign.status === 'succeeded' &&
          typeof campaign.campaignId === 'string' &&
          campaign.campaignId.length > 0 &&
          typeof campaign.campaignRowId === 'string' &&
          campaign.campaignRowId.length > 0,
        )
        .map((campaign) => ({
          id: campaign.campaignId,
          campaignRowId: campaign.campaignRowId,
          name: campaign.campaignName,
          leadsImported: campaign.leadsImported ?? 0,
          conversationsImported: campaign.conversationsImported ?? 0,
          totalsStatsImported: campaign.totalsStatsImported ?? false,
          dayByDayStatsImported: campaign.dayByDayStatsImported ?? false,
          conversationZeroReason: conversationZeroReason(campaign.conversationDiagnostics),
        })),
    [reviewCampaignResults],
  );

  const selectedReviewCampaign = useMemo(
    () => reviewCampaignOptions.find((campaign) => campaign.id === selectedReviewCampaignId) ?? null,
    [reviewCampaignOptions, selectedReviewCampaignId],
  );
  const selectedReviewCampaignFurnaceId = selectedReviewCampaign?.id ?? null;

  useEffect(() => {
    if (reviewCampaignOptions.length === 0) {
      setSelectedReviewCampaignId(null);
      setLeadRows([]);
      setLeadRowsError(null);
      setConversationRows([]);
      setConversationRowsError(null);
      return;
    }

    if (!selectedReviewCampaignId || !reviewCampaignOptions.some((campaign) => campaign.id === selectedReviewCampaignId)) {
      setSelectedReviewCampaignId(reviewCampaignOptions[0].id);
      setConversationPage(0);
      setLeadPage(0);
    }
  }, [reviewCampaignOptions, selectedReviewCampaignId]);

  useEffect(() => {
    if (step !== 3 || activeReviewTab !== 'leads' || !selectedReviewCampaignFurnaceId) {
      return;
    }

    let cancelled = false;
    setLeadRowsLoading(true);
    setLeadRowsError(null);

    getLeads({
      campaignId: selectedReviewCampaignFurnaceId,
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
  }, [step, activeReviewTab, selectedReviewCampaignFurnaceId, leadPage]);

  useEffect(() => {
    if (step !== 3 || activeReviewTab !== 'conversations' || !selectedReviewCampaignFurnaceId || !account?.id) {
      return;
    }

    let cancelled = false;
    setConversationRowsLoading(true);
    setConversationRowsError(null);

    getThreadsByAccount(account.id, {
      campaignId: selectedReviewCampaignFurnaceId,
      limit: REVIEW_PAGE_SIZE,
      offset: conversationPage * REVIEW_PAGE_SIZE,
    })
      .then((result) => {
        if (!cancelled) setConversationRows(result.threads);
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
  }, [step, activeReviewTab, selectedReviewCampaignFurnaceId, conversationPage, account?.id]);

  const handleFetchCampaigns = useCallback(async () => {
    setStep(1);
    setLoading(true);
    setError(null);
    setCampaigns([]);
    setSelectedIds(new Set());
    try {
      const list = await fetchSmartleadCampaigns(apiKey.trim());
      setCampaigns(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch campaigns.');
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

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === campaigns.length) return new Set();
      return new Set(campaigns.map((campaign) => campaign.id));
    });
  }, [campaigns]);

  const handleMigrate = useCallback(async () => {
    if (!account || !user) return;
    const selected = campaigns.filter((campaign) => selectedIds.has(campaign.id));
    if (selected.length === 0) return;

    setStep(2);
    setMigrating(true);
    setRun(null);
    setRunCampaignRows([]);
    setRunEvents([]);
    setResult(null);
    setError(null);
    setActiveReviewTab('summary');
    setSelectedReviewCampaignId(null);
    setLeadPage(0);
    setLeadRows([]);
    setLeadRowsLoading(false);
    setLeadRowsError(null);
    setConversationPage(0);
    setConversationRows([]);
    setConversationRowsLoading(false);
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Migration failed.');
      setMigrating(false);
    }
  }, [apiKey, campaigns, selectedIds, account, user, refreshRunState]);

  const handleCancelRun = useCallback(async () => {
    if (!runId) return;
    try {
      await cancelSmartleadMigrationRun(runId);
      await refreshRunState(runId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel migration.');
    }
  }, [runId, refreshRunState]);

  const handleStartNewMigration = useCallback(() => {
    resetModalState({ preserveApiKey: true, step: 0 });
  }, [resetModalState]);

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
    setActiveReviewTab('summary');
    setSelectedReviewCampaignId(null);
    setResult(null);
    setRun(null);
    setRunCampaignRows([]);
    setRunEvents([]);
    setProgress(null);
    setMigrating(true);
    setLeadPage(0);
    setLeadRows([]);
    setLeadRowsLoading(false);
    setLeadRowsError(null);
    setConversationPage(0);
    setConversationRows([]);
    setConversationRowsLoading(false);
    setConversationRowsError(null);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retry failed campaigns.');
      setMigrating(false);
    }
  }, [account, apiKey, runCampaignRows, refreshRunState]);

  const isBootstrapping = step === undefined;
  const isApiKeyStep = step === 0;
  const isCampaignStep = step === 1;
  const isProgressStep = step === 2;
  const isReviewStep = step === 3;
  const isCampaignLoading = isCampaignStep && loading;
  const isRunLoading = (isProgressStep || isReviewStep) && !run && runId !== null;
  const showBootstrapSkeleton = isBootstrapping;
  const showCampaignSkeleton = isCampaignLoading;
  const showRunSkeleton = isRunLoading;
  const footerMode =
    isBootstrapping || isCampaignLoading || isRunLoading
      ? 'hidden'
      : isApiKeyStep
        ? 'api-key'
        : isCampaignStep
          ? 'campaigns'
          : isProgressStep
            ? migrating
              ? 'run-active'
              : 'run-complete'
            : isReviewStep
              ? 'review'
              : 'hidden';
  const canNext = isApiKeyStep && apiKey.trim().length > 0;
  const canMigrate = isCampaignStep && selectedIds.size > 0 && !loading;
  const canReview = isProgressStep && !migrating && !!result;
  const canRetryFailed =
    !migrating &&
    runCampaignRows.some((row) => row.status === 'failed' || row.status === 'cancelled') &&
    apiKey.trim().length > 0;
  const eventsSummary = `${formatCount(runEvents.length)} recent events`;

  const footer = (
    <View className="flex-row items-center justify-between">
      <View>
        {footerMode === 'campaigns' && !migrating && (
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
        {footerMode === 'api-key' && (
          <Button onPress={handleFetchCampaigns} disabled={!canNext}>
            Next
          </Button>
        )}
        {footerMode === 'campaigns' && (
          <Button onPress={handleMigrate} disabled={!canMigrate}>
            Start Background Migration ({selectedIds.size})
          </Button>
        )}
        {footerMode === 'run-active' && (
          <Button onPress={handleCancelRun} variant="secondary">
            Cancel Run
          </Button>
        )}
        {footerMode === 'run-complete' && canReview && (
          <Button onPress={() => setStep(3)}>
            Review Results
          </Button>
        )}
        {footerMode === 'review' && (
          <>
            <Button onPress={handleStartNewMigration}>Start New Migration</Button>
            {canRetryFailed && (
              <Button onPress={handleRetryFailed} variant="secondary">
                Retry Failed Campaigns
              </Button>
            )}
            <Button onPress={onClose} variant="secondary">
              Close
            </Button>
          </>
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
        {showBootstrapSkeleton ? (
          <MigrationStepIndicatorSkeleton />
        ) : (
          <WizardStepIndicator steps={STEPS} activeIndex={step ?? 0} wrap />
        )}

        {showBootstrapSkeleton && <MigrationBootstrapSkeleton />}

        {isApiKeyStep && <ApiKeyStep apiKey={apiKey} onApiKeyChange={setApiKey} />}

        {isCampaignStep && (
          <CampaignSelectionStep
            showSkeleton={showCampaignSkeleton}
            loading={loading}
            error={error}
            campaigns={campaigns}
            selectedIds={selectedIds}
            campaignSearchQuery={campaignSearchQuery}
            filteredCampaignRows={filteredCampaignRows}
            campaignSelectedKeys={campaignSelectedKeys}
            onToggleAll={toggleAll}
            onSearchChange={setCampaignSearchQuery}
            onSelectionChange={(keys) => setSelectedIds(new Set(Array.from(keys).map(Number)))}
          />
        )}

        {isProgressStep && (
          <MigrationProgressStep
            error={error}
            run={run}
            migrating={migrating}
            progress={progress}
            runEvents={runEvents}
            showRunSkeleton={showRunSkeleton}
            windowHeight={windowHeight}
            eventsSummary={eventsSummary}
          />
        )}

        {isReviewStep && (
          <MigrationReviewStep
            run={run}
            result={result}
            reviewCampaignResults={reviewCampaignResults}
            reviewCampaignOptions={reviewCampaignOptions}
            selectedReviewCampaign={selectedReviewCampaign}
            activeReviewTab={activeReviewTab}
            leadPage={leadPage}
            leadRows={leadRows}
            leadRowsLoading={leadRowsLoading}
            leadRowsError={leadRowsError}
            conversationPage={conversationPage}
            conversationRows={conversationRows}
            conversationRowsLoading={conversationRowsLoading}
            conversationRowsError={conversationRowsError}
            runEvents={runEvents}
            onReviewTabChange={setActiveReviewTab}
            onReviewCampaignChange={(id) => {
              setSelectedReviewCampaignId(id);
              setLeadPage(0);
              setConversationPage(0);
              setLeadRows([]);
              setLeadRowsError(null);
              setConversationRows([]);
              setConversationRowsError(null);
            }}
            onLeadPrevious={() => setLeadPage((page) => Math.max(0, page - 1))}
            onLeadNext={() => setLeadPage((page) => page + 1)}
            onConversationPrevious={() => setConversationPage((page) => Math.max(0, page - 1))}
            onConversationNext={() => setConversationPage((page) => page + 1)}
          />
        )}
      </View>
    </BaseModal>
  );
}
