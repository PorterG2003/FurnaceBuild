import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Alert, LoadingState, useSmoothLoading } from '@/components/ui/feedback';
import { WorkbenchBulkReviewSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { useAccount } from '@/contexts/AccountContext';
import { isSmartleadCampaign } from '@/lib/campaigns/utils';
import { ADD_TO_CAMPAIGN_REVIEW_HELP } from '@/lib/leads/workbench/addToCampaignReviewHelp';
import { pollImportJobUntilDone } from '@/lib/leads/workbench/bulk/pollImportJobUntilDone';
import {
  WorkbenchBulkMetricRow,
  WorkbenchBulkMetricsGrid,
} from '@/lib/leads/workbench/bulk/workbenchBulkModalMetrics';
import {
  addGlobalLeadsToCampaign,
  type AddGlobalLeadsToCampaignResult,
} from '@/lib/supabase/services/leads/add-to-campaign';
import {
  startAddToCampaignJob,
  startAddToCampaignJobForList,
  enqueueAccountImportJob,
  mapImportJobToAddResult,
} from '@/lib/supabase/services/leads/add-to-campaign-jobs';
import {
  getAddToCampaignReviewSummary,
  getAddToCampaignReviewSummaryForList,
  type AddToCampaignReviewSummary,
} from '@/lib/supabase/services/leads/add-to-campaign-review';
import { getCampaignsListSummary, type CampaignListSummary } from '@/lib/supabase/services/campaigns/campaign-list-summary';
import { getAccessToken } from '@/lib/supabase/client';
import {
  ADD_TO_CAMPAIGN_SYNC_THRESHOLD,
} from '@/lib/leads/workbench/addToCampaignConstants';

type Step = 'choose' | 'review' | 'adding';

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

function campaignEmptyMessage(hasSearch: boolean): string {
  return hasSearch ? 'No campaigns match' : 'No native campaigns available.';
}

export function LeadsAddToCampaignModal({
  visible,
  globalLeadIds,
  savedListId = null,
  scopeLabel,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  globalLeadIds: string[];
  savedListId?: string | null;
  scopeLabel: string;
  prefetchDataset?: unknown;
  onClose: () => void;
  onSuccess: (result: AddGlobalLeadsToCampaignResult) => void;
}) {
  const { account } = useAccount();
  const [step, setStep] = useState<Step>('choose');
  const [campaigns, setCampaigns] = useState<CampaignListSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [reviewSummary, setReviewSummary] = useState<AddToCampaignReviewSummary | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const showReviewSkeleton = useSmoothLoading(reviewLoading);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Adding leads to campaign...');
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [sessionLeadIds, setSessionLeadIds] = useState<string[]>([]);
  const [sessionScopeLabel, setSessionScopeLabel] = useState('');
  const wasVisibleRef = useRef(false);

  const nativeCampaigns = useMemo(
    () => campaigns.filter((campaign) => !isSmartleadCampaign(campaign)),
    [campaigns],
  );

  const selectedCampaign = useMemo(
    () => nativeCampaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [nativeCampaigns, selectedCampaignId],
  );

  const useAsyncAdd = Boolean(savedListId) || sessionLeadIds.length > ADD_TO_CAMPAIGN_SYNC_THRESHOLD;

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setSessionLeadIds(savedListId ? [] : [...globalLeadIds]);
      setSessionScopeLabel(scopeLabel);
      setStep('choose');
      setSaving(false);
      setSelectedCampaignId(null);
      setReviewSummary(null);
      setError(null);
      setProgress(null);
      setLoadingMessage('Adding leads to campaign...');
    }
    wasVisibleRef.current = visible;
  }, [globalLeadIds, savedListId, scopeLabel, visible]);

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
      const summary = savedListId
        ? await getAddToCampaignReviewSummaryForList(account.id, selectedCampaignId, savedListId)
        : await getAddToCampaignReviewSummary(account.id, selectedCampaignId, sessionLeadIds);
      setReviewSummary(summary);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load review details.');
    } finally {
      setReviewLoading(false);
    }
  }, [account?.id, savedListId, sessionLeadIds, selectedCampaignId]);

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
      setStep('adding');
      setError(null);
      setProgress(savedListId ? null : { processed: 0, total: sessionLeadIds.length });

      if (useAsyncAdd) {
        setLoadingMessage('Queueing add to campaign...');
        const jobId = savedListId
          ? await startAddToCampaignJobForList(account.id, selectedCampaignId, savedListId)
          : await startAddToCampaignJob(account.id, selectedCampaignId, sessionLeadIds);
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error('Sign in required to run large add-to-campaign jobs.');
        }
        await enqueueAccountImportJob(jobId, accessToken);
        setLoadingMessage('Adding leads to campaign...');

        const job = await pollImportJobUntilDone(jobId);
        if (job.status === 'failed') {
          throw new Error('Add to campaign job failed.');
        }
        const result = mapImportJobToAddResult(job);
        onClose();
        onSuccess(result);
        return;
      }

      const result = await addGlobalLeadsToCampaign(account.id, selectedCampaignId, sessionLeadIds, {
        onProgress: (processed, total) => {
          setProgress({ processed, total });
        },
      });

      onClose();
      onSuccess(result);
    } catch (nextError) {
      setStep('review');
      setError(nextError instanceof Error ? nextError.message : 'Failed to add leads to campaign.');
    } finally {
      setSaving(false);
      setProgress(null);
      setLoadingMessage('Adding leads to campaign...');
    }
  }, [account?.id, onClose, onSuccess, savedListId, selectedCampaignId, sessionLeadIds, useAsyncAdd]);

  const footer =
    step === 'adding' ? null : step === 'choose' ? (
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
          disabled={reviewLoading || (!savedListId && sessionLeadIds.length === 0)}
        >
          Add to campaign
        </Button>
      </ModalFooter>
    );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Add to campaign"
      description={`Add ${sessionScopeLabel || scopeLabel} to a native Furnace campaign. Existing rows in the target campaign are updated and enrolled.`}
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-4">
        {error ? <Alert variant="error" message={error} /> : null}

        {step === 'adding' ? (
          <LoadingState
            message={
              progress
                ? `${loadingMessage} (${progress.processed}/${progress.total})`
                : loadingMessage
            }
            className="py-12"
          />
        ) : null}

        {step === 'choose' ? (
          <>
            <Select<CampaignListSummary>
              label="Campaign"
              items={nativeCampaigns}
              getItemId={(item) => item.id}
              getItemLabel={formatCampaignLabel}
              value={selectedCampaignId}
              onChange={(id) => setSelectedCampaignId(id)}
              placeholder={campaignsLoading ? 'Loading campaigns…' : 'Select a campaign'}
              searchPlaceholder="Search campaigns…"
              emptyMessage={campaignEmptyMessage}
              loading={campaignsLoading}
              variant="solid"
              listMaxHeight={280}
            />
          </>
        ) : null}

        {step === 'review' ? (
          <>
            {reviewLoading || showReviewSkeleton ? (
              <WorkbenchBulkReviewSkeleton />
            ) : selectedCampaign && reviewSummary ? (
              <WorkbenchBulkMetricsGrid>
                <Text className="text-white font-instrument text-sm mb-1">
                  Target: {selectedCampaign.name}
                </Text>
                <WorkbenchBulkMetricRow
                  label="People in scope"
                  value={reviewSummary.selectedPeople}
                  help={ADD_TO_CAMPAIGN_REVIEW_HELP.peopleInScope}
                />
                <WorkbenchBulkMetricRow
                  label="Already in this campaign"
                  value={reviewSummary.alreadyInCampaign}
                  help={ADD_TO_CAMPAIGN_REVIEW_HELP.alreadyInCampaign}
                />
                <WorkbenchBulkMetricRow
                  label="Memberships in scope"
                  value={reviewSummary.membershipsInScope}
                  help={ADD_TO_CAMPAIGN_REVIEW_HELP.membershipsInScope}
                />
                <WorkbenchBulkMetricRow
                  label="Native memberships"
                  value={reviewSummary.nativeMemberships}
                  help={ADD_TO_CAMPAIGN_REVIEW_HELP.nativeMemberships}
                />
                <WorkbenchBulkMetricRow
                  label="Smartlead memberships"
                  value={reviewSummary.smartleadMemberships}
                  help={ADD_TO_CAMPAIGN_REVIEW_HELP.smartleadMemberships}
                />
                <WorkbenchBulkMetricRow
                  label="People with replies"
                  value={reviewSummary.peopleWithReplies}
                  help={ADD_TO_CAMPAIGN_REVIEW_HELP.peopleWithReplies}
                />
                <WorkbenchBulkMetricRow
                  label="Company conflicts"
                  value={reviewSummary.peopleWithConflictingCompanies}
                  help={ADD_TO_CAMPAIGN_REVIEW_HELP.companyConflicts}
                />
              </WorkbenchBulkMetricsGrid>
            ) : null}
          </>
        ) : null}
      </View>
    </BaseModal>
  );
}
