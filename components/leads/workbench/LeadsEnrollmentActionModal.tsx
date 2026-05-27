import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Alert, LoadingState, useSmoothLoading } from '@/components/ui/feedback';
import { WorkbenchBulkReviewSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { useAccount } from '@/contexts/AccountContext';
import { isSmartleadCampaign } from '@/lib/campaigns/utils';
import { pollImportJobUntilDone } from '@/lib/leads/workbench/bulk/pollImportJobUntilDone';
import {
  WorkbenchBulkMetricRow,
  WorkbenchBulkMetricsGrid,
} from '@/lib/leads/workbench/bulk/workbenchBulkModalMetrics';
import {
  PAUSE_ENROLLMENTS_REVIEW_HELP,
  RESUME_ENROLLMENTS_REVIEW_HELP,
} from '@/lib/leads/workbench/pauseResumeMembershipsHelp';
import { PAUSE_RESUME_SYNC_THRESHOLD } from '@/lib/leads/workbench/pauseResumeMembershipsConstants';
import { getPauseEnrollmentsReviewSummary, getPauseEnrollmentsReviewSummaryForList } from '@/lib/supabase/services/leads/pause-enrollments-review';
import { getResumeEnrollmentsReviewSummary, getResumeEnrollmentsReviewSummaryForList } from '@/lib/supabase/services/leads/resume-enrollments-review';
import { pauseEnrollmentsForLeads } from '@/lib/supabase/services/leads/pause-enrollments';
import { resumeEnrollmentsForLeads } from '@/lib/supabase/services/leads/resume-enrollments';
import {
  enqueueEnrollmentActionJob,
  mapImportJobToEnrollmentActionResult,
  startPauseEnrollmentsJob,
  startPauseEnrollmentsJobForList,
  startResumeEnrollmentsJob,
  startResumeEnrollmentsJobForList,
} from '@/lib/supabase/services/leads/enrollment-action-jobs';
import { getCampaignsListSummary, type CampaignListSummary } from '@/lib/supabase/services/campaigns/campaign-list-summary';
import { getAccessToken } from '@/lib/supabase/client';

export type EnrollmentActionKind = 'pause' | 'resume';

type Step = 'choose' | 'review' | 'applying';

function formatCampaignLabel(campaign: CampaignListSummary) {
  const status =
    campaign.status === 'running'
      ? 'Running'
      : campaign.status === 'paused'
        ? 'Paused'
        : campaign.status === 'stopped'
          ? 'Stopped'
          : 'Draft';
  return { primary: campaign.name, secondary: status };
}

function campaignEmptyMessage(hasSearch: boolean, action: EnrollmentActionKind): string {
  if (hasSearch) return 'No campaigns match';
  return action === 'pause'
    ? 'No eligible native campaigns available.'
    : 'No running native campaigns available.';
}

function filterCampaignsForAction(campaigns: CampaignListSummary[], action: EnrollmentActionKind) {
  const native = campaigns.filter((campaign) => !isSmartleadCampaign(campaign));
  if (action === 'resume') {
    return native.filter((campaign) => campaign.status === 'running');
  }
  return native.filter(
    (campaign) =>
      campaign.status === 'draft' || campaign.status === 'running' || campaign.status === 'paused',
  );
}

export function LeadsEnrollmentActionModal({
  action,
  visible,
  globalLeadIds,
  savedListId = null,
  scopeLabel,
  onClose,
  onSuccess,
}: {
  action: EnrollmentActionKind;
  visible: boolean;
  globalLeadIds: string[];
  savedListId?: string | null;
  scopeLabel: string;
  onClose: () => void;
  onSuccess: (result: { affected: number; skipped: number }) => void;
}) {
  const { account } = useAccount();
  const [step, setStep] = useState<Step>('choose');
  const [campaigns, setCampaigns] = useState<CampaignListSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [pauseReview, setPauseReview] = useState<Awaited<
    ReturnType<typeof getPauseEnrollmentsReviewSummary>
  > | null>(null);
  const [resumeReview, setResumeReview] = useState<Awaited<
    ReturnType<typeof getResumeEnrollmentsReviewSummary>
  > | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const showReviewSkeleton = useSmoothLoading(reviewLoading);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [sessionLeadIds, setSessionLeadIds] = useState<string[]>([]);
  const [sessionScopeLabel, setSessionScopeLabel] = useState('');
  const wasVisibleRef = useRef(false);

  const isPause = action === 'pause';
  const title = isPause ? 'Pause memberships' : 'Resume memberships';
  const confirmLabel = isPause ? 'Pause memberships' : 'Resume memberships';
  const eligibleCampaigns = useMemo(
    () => filterCampaignsForAction(campaigns, action),
    [action, campaigns],
  );
  const selectedCampaign = useMemo(
    () => eligibleCampaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [eligibleCampaigns, selectedCampaignId],
  );
  const useAsyncAction = Boolean(savedListId) || sessionLeadIds.length > PAUSE_RESUME_SYNC_THRESHOLD;

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setSessionLeadIds(savedListId ? [] : [...globalLeadIds]);
      setSessionScopeLabel(scopeLabel);
      setStep('choose');
      setSaving(false);
      setSelectedCampaignId(null);
      setPauseReview(null);
      setResumeReview(null);
      setError(null);
      setLoadingMessage(isPause ? 'Pausing memberships...' : 'Resuming memberships...');
    }
    wasVisibleRef.current = visible;
  }, [globalLeadIds, isPause, savedListId, scopeLabel, visible]);

  useEffect(() => {
    if (!visible || !account?.id) {
      setCampaigns([]);
      return;
    }

    let cancelled = false;
    setCampaignsLoading(true);
    void (async () => {
      try {
        const rows = await getCampaignsListSummary(account.id);
        if (!cancelled) setCampaigns(rows);
      } catch {
        if (!cancelled) setCampaigns([]);
      } finally {
        if (!cancelled) setCampaignsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id, visible]);

  const loadReviewData = useCallback(async () => {
    if (!account?.id || !selectedCampaignId) return;

    setReviewLoading(true);
    setError(null);
    try {
      if (isPause) {
        const summary = savedListId
          ? await getPauseEnrollmentsReviewSummaryForList(account.id, selectedCampaignId, savedListId)
          : await getPauseEnrollmentsReviewSummary(account.id, selectedCampaignId, sessionLeadIds);
        setPauseReview(summary);
        setResumeReview(null);
      } else {
        const summary = savedListId
          ? await getResumeEnrollmentsReviewSummaryForList(account.id, selectedCampaignId, savedListId)
          : await getResumeEnrollmentsReviewSummary(account.id, selectedCampaignId, sessionLeadIds);
        setResumeReview(summary);
        setPauseReview(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load review details.');
    } finally {
      setReviewLoading(false);
    }
  }, [account?.id, isPause, savedListId, selectedCampaignId, sessionLeadIds]);

  const handleClose = useCallback(() => {
    if (saving) return;
    setError(null);
    onClose();
  }, [onClose, saving]);

  const handleContinueToReview = useCallback(() => {
    if (!selectedCampaignId) {
      setError('Choose a campaign first.');
      return;
    }
    setStep('review');
    void loadReviewData();
  }, [loadReviewData, selectedCampaignId]);

  const handleConfirm = useCallback(async () => {
    if (!account?.id) {
      setError('No active account found.');
      return;
    }
    if (!selectedCampaignId) {
      setError('Choose a campaign first.');
      return;
    }
    if (!savedListId && sessionLeadIds.length === 0) {
      setError('No leads selected.');
      return;
    }

    try {
      setSaving(true);
      setStep('applying');
      setError(null);

      if (useAsyncAction) {
        setLoadingMessage(isPause ? 'Queueing pause...' : 'Queueing resume...');
        const jobId = isPause
          ? savedListId
            ? await startPauseEnrollmentsJobForList(account.id, selectedCampaignId, savedListId)
            : await startPauseEnrollmentsJob(account.id, selectedCampaignId, sessionLeadIds)
          : savedListId
            ? await startResumeEnrollmentsJobForList(account.id, selectedCampaignId, savedListId)
            : await startResumeEnrollmentsJob(account.id, selectedCampaignId, sessionLeadIds);
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error('Sign in required to run large enrollment actions.');
        }
        await enqueueEnrollmentActionJob(jobId, accessToken);
        setLoadingMessage(isPause ? 'Pausing memberships...' : 'Resuming memberships...');

        const job = await pollImportJobUntilDone(jobId);
        if (job.status === 'failed') {
          throw new Error(isPause ? 'Pause memberships job failed.' : 'Resume memberships job failed.');
        }
        const result = mapImportJobToEnrollmentActionResult(job, action);
        onClose();
        onSuccess({ affected: result.affected, skipped: result.skipped });
        return;
      }

      const result = isPause
        ? await pauseEnrollmentsForLeads(account.id, selectedCampaignId, sessionLeadIds)
        : await resumeEnrollmentsForLeads(account.id, selectedCampaignId, sessionLeadIds);

      onClose();
      onSuccess({
        affected: isPause ? result.paused : result.resumed,
        skipped: result.skipped,
      });
    } catch (nextError) {
      setStep('review');
      setError(
        nextError instanceof Error
          ? nextError.message
          : isPause
            ? 'Failed to pause memberships.'
            : 'Failed to resume memberships.',
      );
    } finally {
      setSaving(false);
    }
  }, [
    account?.id,
    action,
    isPause,
    onClose,
    onSuccess,
    savedListId,
    selectedCampaignId,
    sessionLeadIds,
    useAsyncAction,
  ]);

  const footer =
    step === 'applying' ? null : step === 'choose' ? (
      <ModalFooter>
        <Button variant="secondary" onPress={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button onPress={handleContinueToReview} disabled={!selectedCampaignId || campaignsLoading}>
          Continue
        </Button>
      </ModalFooter>
    ) : (
      <ModalFooter>
        <Button variant="secondary" onPress={() => setStep('choose')} disabled={saving}>
          Back
        </Button>
        <Button
          onPress={() => void handleConfirm()}
          disabled={
            reviewLoading ||
            (!savedListId && sessionLeadIds.length === 0) ||
            (isPause ? pauseReview?.smartleadCampaign : resumeReview?.smartleadCampaign) ||
            (!isPause && resumeReview?.campaignNotRunning)
          }
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    );

  const description = isPause
    ? `Pause ${sessionScopeLabel || scopeLabel} in a native Furnace campaign. Queued sends are deferred until you resume.`
    : `Resume ${sessionScopeLabel || scopeLabel} in a running native campaign.`;

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title={title}
      description={description}
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-4">
        {error ? <Alert variant="error" message={error} /> : null}

        {step === 'applying' ? (
          <LoadingState message={loadingMessage} className="py-12" />
        ) : null}

        {step === 'choose' ? (
          <>
            <Select<CampaignListSummary>
              label="Campaign"
              items={eligibleCampaigns}
              getItemId={(item) => item.id}
              getItemLabel={formatCampaignLabel}
              value={selectedCampaignId}
              onChange={(id) => setSelectedCampaignId(id)}
              placeholder={campaignsLoading ? 'Loading campaigns…' : 'Select a campaign'}
              searchPlaceholder="Search campaigns…"
              emptyMessage={(hasSearch) => campaignEmptyMessage(hasSearch, action)}
              loading={campaignsLoading}
              variant="solid"
              listMaxHeight={280}
            />
          </>
        ) : null}

        {step === 'review' ? (
          <>
            {!isPause && resumeReview?.campaignNotRunning ? (
              <Alert
                variant="warning"
                message="This campaign is not running. Resume the campaign first, then resume these memberships."
              />
            ) : null}
            {reviewLoading || showReviewSkeleton ? (
              <WorkbenchBulkReviewSkeleton />
            ) : selectedCampaign && (isPause ? pauseReview : resumeReview) ? (
              <WorkbenchBulkMetricsGrid>
                <Text className="text-white font-instrument text-sm mb-1">
                  Target: {selectedCampaign.name}
                </Text>
                {isPause && pauseReview ? (
                  <>
                    <WorkbenchBulkMetricRow
                      label="People in scope"
                      value={pauseReview.selectedPeople}
                      help={PAUSE_ENROLLMENTS_REVIEW_HELP.peopleInScope}
                    />
                    <WorkbenchBulkMetricRow
                      label="Active in campaign"
                      value={pauseReview.activeInCampaign}
                      help={PAUSE_ENROLLMENTS_REVIEW_HELP.activeInCampaign}
                    />
                    <WorkbenchBulkMetricRow
                      label="Already paused"
                      value={pauseReview.alreadyPausedInCampaign}
                      help={PAUSE_ENROLLMENTS_REVIEW_HELP.alreadyPaused}
                    />
                    <WorkbenchBulkMetricRow
                      label="Not in campaign"
                      value={pauseReview.notInCampaign}
                      help={PAUSE_ENROLLMENTS_REVIEW_HELP.notInCampaign}
                    />
                    <WorkbenchBulkMetricRow
                      label="Terminal enrollments"
                      value={pauseReview.terminalInCampaign}
                      help={PAUSE_ENROLLMENTS_REVIEW_HELP.terminalInCampaign}
                    />
                  </>
                ) : null}
                {!isPause && resumeReview ? (
                  <>
                    <WorkbenchBulkMetricRow
                      label="People in scope"
                      value={resumeReview.selectedPeople}
                      help={RESUME_ENROLLMENTS_REVIEW_HELP.peopleInScope}
                    />
                    <WorkbenchBulkMetricRow
                      label="Paused in campaign"
                      value={resumeReview.pausedInCampaign}
                      help={RESUME_ENROLLMENTS_REVIEW_HELP.pausedInCampaign}
                    />
                    <WorkbenchBulkMetricRow
                      label="Already active"
                      value={resumeReview.alreadyActiveInCampaign}
                      help={RESUME_ENROLLMENTS_REVIEW_HELP.alreadyActive}
                    />
                    <WorkbenchBulkMetricRow
                      label="Not in campaign"
                      value={resumeReview.notInCampaign}
                      help={RESUME_ENROLLMENTS_REVIEW_HELP.notInCampaign}
                    />
                    <WorkbenchBulkMetricRow
                      label="Campaign not running"
                      value={resumeReview.campaignNotRunning}
                      help={RESUME_ENROLLMENTS_REVIEW_HELP.campaignNotRunning}
                    />
                  </>
                ) : null}
              </WorkbenchBulkMetricsGrid>
            ) : null}
          </>
        ) : null}
      </View>
    </BaseModal>
  );
}

export function LeadsPauseMembershipsModal(
  props: Omit<ComponentProps<typeof LeadsEnrollmentActionModal>, 'action'>,
) {
  return <LeadsEnrollmentActionModal {...props} action="pause" />;
}

export function LeadsResumeMembershipsModal(
  props: Omit<ComponentProps<typeof LeadsEnrollmentActionModal>, 'action'>,
) {
  return <LeadsEnrollmentActionModal {...props} action="resume" />;
}
