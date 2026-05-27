import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
  REMOVE_FROM_ALL_CAMPAIGNS_REVIEW_HELP,
  REMOVE_FROM_CAMPAIGN_REVIEW_HELP,
} from '@/lib/leads/workbench/removeMembershipsHelp';
import { REMOVE_SYNC_THRESHOLD } from '@/lib/leads/workbench/removeMembershipsConstants';
import { getRemoveFromCampaignReviewSummary, getRemoveFromCampaignReviewSummaryForList } from '@/lib/supabase/services/leads/remove-from-campaign-review';
import { getRemoveFromAllCampaignsReviewSummary, getRemoveFromAllCampaignsReviewSummaryForList } from '@/lib/supabase/services/leads/remove-from-all-campaigns-review';
import { removeGlobalLeadsFromCampaign } from '@/lib/supabase/services/leads/remove-from-campaign';
import { removeGlobalLeadsFromAllCampaigns } from '@/lib/supabase/services/leads/remove-from-all-campaigns';
import {
  enqueueRemoveMembershipJob,
  mapImportJobToRemoveResult,
  startRemoveFromAllCampaignsJob,
  startRemoveFromAllCampaignsJobForList,
  startRemoveFromCampaignJob,
  startRemoveFromCampaignJobForList,
} from '@/lib/supabase/services/leads/remove-from-campaign-jobs';
import { getCampaignsListSummary, type CampaignListSummary } from '@/lib/supabase/services/campaigns/campaign-list-summary';
import { getAccessToken } from '@/lib/supabase/client';

export type RemoveMembershipScopeMode = 'campaign' | 'all';

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

function filterNativeCampaigns(campaigns: CampaignListSummary[]) {
  return campaigns.filter((campaign) => !isSmartleadCampaign(campaign));
}

function ScopeToggle({
  value,
  onChange,
}: {
  value: RemoveMembershipScopeMode;
  onChange: (next: RemoveMembershipScopeMode) => void;
}) {
  return (
    <View className="flex-row gap-2">
      <Pressable
        onPress={() => onChange('campaign')}
        className={`flex-1 rounded-xl border px-3 py-3 ${
          value === 'campaign' ? 'border-brand-orange bg-brand-orange/10' : 'border-[#2A2A2A] bg-[#181818]'
        }`}
      >
        <Text
          className={`font-instrument-semibold text-sm text-center ${
            value === 'campaign' ? 'text-brand-orange' : 'text-gray-300'
          }`}
        >
          One campaign
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('all')}
        className={`flex-1 rounded-xl border px-3 py-3 ${
          value === 'all' ? 'border-brand-orange bg-brand-orange/10' : 'border-[#2A2A2A] bg-[#181818]'
        }`}
      >
        <Text
          className={`font-instrument-semibold text-sm text-center ${
            value === 'all' ? 'text-brand-orange' : 'text-gray-300'
          }`}
        >
          All campaigns
        </Text>
      </Pressable>
    </View>
  );
}

export function LeadsRemoveMembershipsModal({
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
  onClose: () => void;
  onSuccess: (result: { removed: number; skipped: number }) => void;
}) {
  const { account } = useAccount();
  const [step, setStep] = useState<Step>('choose');
  const [scopeMode, setScopeMode] = useState<RemoveMembershipScopeMode>('campaign');
  const [campaigns, setCampaigns] = useState<CampaignListSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignReview, setCampaignReview] = useState<Awaited<
    ReturnType<typeof getRemoveFromCampaignReviewSummary>
  > | null>(null);
  const [allReview, setAllReview] = useState<Awaited<
    ReturnType<typeof getRemoveFromAllCampaignsReviewSummary>
  > | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const showReviewSkeleton = useSmoothLoading(reviewLoading);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [sessionLeadIds, setSessionLeadIds] = useState<string[]>([]);
  const [sessionScopeLabel, setSessionScopeLabel] = useState('');
  const wasVisibleRef = useRef(false);

  const isSingleCampaign = scopeMode === 'campaign';
  const eligibleCampaigns = useMemo(() => filterNativeCampaigns(campaigns), [campaigns]);
  const selectedCampaign = useMemo(
    () => eligibleCampaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [eligibleCampaigns, selectedCampaignId],
  );
  const useAsyncAction = Boolean(savedListId) || sessionLeadIds.length > REMOVE_SYNC_THRESHOLD;

  const confirmLabel = 'Remove';

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setSessionLeadIds(savedListId ? [] : [...globalLeadIds]);
      setSessionScopeLabel(scopeLabel);
      setStep('choose');
      setScopeMode('campaign');
      setSaving(false);
      setSelectedCampaignId(null);
      setCampaignReview(null);
      setAllReview(null);
      setError(null);
      setLoadingMessage('Removing memberships...');
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
    if (!account?.id) return;
    if (isSingleCampaign && !selectedCampaignId) return;

    setReviewLoading(true);
    setError(null);
    try {
      if (isSingleCampaign && selectedCampaignId) {
        const summary = savedListId
          ? await getRemoveFromCampaignReviewSummaryForList(account.id, selectedCampaignId, savedListId)
          : await getRemoveFromCampaignReviewSummary(account.id, selectedCampaignId, sessionLeadIds);
        setCampaignReview(summary);
        setAllReview(null);
      } else {
        const summary = savedListId
          ? await getRemoveFromAllCampaignsReviewSummaryForList(account.id, savedListId)
          : await getRemoveFromAllCampaignsReviewSummary(account.id, sessionLeadIds);
        setAllReview(summary);
        setCampaignReview(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load review details.');
    } finally {
      setReviewLoading(false);
    }
  }, [account?.id, isSingleCampaign, savedListId, selectedCampaignId, sessionLeadIds]);

  const handleClose = useCallback(() => {
    if (saving) return;
    setError(null);
    onClose();
  }, [onClose, saving]);

  const handleContinueToReview = useCallback(() => {
    if (isSingleCampaign && !selectedCampaignId) {
      setError('Choose a campaign first.');
      return;
    }
    setStep('review');
    void loadReviewData();
  }, [isSingleCampaign, loadReviewData, selectedCampaignId]);

  const handleConfirm = useCallback(async () => {
    if (!account?.id) {
      setError('No active account found.');
      return;
    }
    if (isSingleCampaign && !selectedCampaignId) {
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
        setLoadingMessage('Queueing remove...');
        const jobId = isSingleCampaign
          ? savedListId
            ? await startRemoveFromCampaignJobForList(account.id, selectedCampaignId!, savedListId)
            : await startRemoveFromCampaignJob(account.id, selectedCampaignId!, sessionLeadIds)
          : savedListId
            ? await startRemoveFromAllCampaignsJobForList(account.id, savedListId)
            : await startRemoveFromAllCampaignsJob(account.id, sessionLeadIds);
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error('Sign in required to run large remove actions.');
        }
        await enqueueRemoveMembershipJob(jobId, accessToken);
        setLoadingMessage('Removing memberships...');

        const job = await pollImportJobUntilDone(jobId);
        if (job.status === 'failed') {
          throw new Error('Remove memberships job failed.');
        }
        const result = mapImportJobToRemoveResult(job);
        onClose();
        onSuccess({ removed: result.removed, skipped: result.skipped });
        return;
      }

      const result = isSingleCampaign
        ? await removeGlobalLeadsFromCampaign(account.id, selectedCampaignId!, sessionLeadIds)
        : await removeGlobalLeadsFromAllCampaigns(account.id, sessionLeadIds);

      onClose();
      onSuccess({ removed: result.removed, skipped: result.skipped });
    } catch (nextError) {
      setStep('review');
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to remove memberships.',
      );
    } finally {
      setSaving(false);
    }
  }, [
    account?.id,
    isSingleCampaign,
    onClose,
    onSuccess,
    savedListId,
    selectedCampaignId,
    sessionLeadIds,
    useAsyncAction,
  ]);

  const canConfirm =
    !reviewLoading &&
    (savedListId || sessionLeadIds.length > 0) &&
    (isSingleCampaign
      ? !campaignReview?.smartleadCampaign && (campaignReview?.inCampaign ?? 0) > 0
      : (allReview?.nativeMembershipsToRemove ?? 0) > 0);

  const footer =
    step === 'applying' ? null : step === 'choose' ? (
      <ModalFooter>
        <Button variant="secondary" onPress={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onPress={handleContinueToReview}
          disabled={(isSingleCampaign && !selectedCampaignId) || campaignsLoading}
        >
          Continue
        </Button>
      </ModalFooter>
    ) : (
      <ModalFooter>
        <Button variant="secondary" onPress={() => setStep('choose')} disabled={saving}>
          Back
        </Button>
        <Button variant="destructive" onPress={() => void handleConfirm()} disabled={!canConfirm}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    );

  const description = isSingleCampaign
    ? `Remove ${sessionScopeLabel || scopeLabel} from one native Furnace campaign. This stops enrollments and cancels queued sends.`
    : `Remove ${sessionScopeLabel || scopeLabel} from all native Furnace campaigns. Smartlead memberships are skipped.`;

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Remove memberships"
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
            <ScopeToggle value={scopeMode} onChange={setScopeMode} />
            {isSingleCampaign ? (
              <Select<CampaignListSummary>
                label="Campaign"
                items={eligibleCampaigns}
                getItemId={(item) => item.id}
                getItemLabel={formatCampaignLabel}
                value={selectedCampaignId}
                onChange={(id) => setSelectedCampaignId(id)}
                placeholder={campaignsLoading ? 'Loading campaigns…' : 'Select a campaign'}
                searchPlaceholder="Search campaigns…"
                emptyMessage={(hasSearch) => (hasSearch ? 'No campaigns match' : 'No native campaigns available.')}
                loading={campaignsLoading}
                variant="solid"
                listMaxHeight={280}
              />
            ) : (
              <Alert
                variant="warning"
                message="This removes the selected people from every native campaign they belong to. Smartlead campaigns are not affected."
              />
            )}
          </>
        ) : null}

        {step === 'review' ? (
          <>
            {reviewLoading || showReviewSkeleton ? (
              <WorkbenchBulkReviewSkeleton />
            ) : isSingleCampaign && campaignReview ? (
              <WorkbenchBulkMetricsGrid>
                {selectedCampaign ? (
                  <Text className="text-white font-instrument text-sm mb-1">
                    Target: {selectedCampaign.name}
                  </Text>
                ) : null}
                {campaignReview.smartleadCampaign ? (
                  <Alert
                    variant="error"
                    message={REMOVE_FROM_CAMPAIGN_REVIEW_HELP.smartleadCampaign}
                  />
                ) : null}
                {campaignReview.inCampaign === 0 && !campaignReview.smartleadCampaign ? (
                  <Alert variant="warning" message="No removable memberships in this campaign." />
                ) : null}
                <WorkbenchBulkMetricRow
                  label="People in scope"
                  value={campaignReview.selectedPeople}
                  help={REMOVE_FROM_CAMPAIGN_REVIEW_HELP.peopleInScope}
                />
                <WorkbenchBulkMetricRow
                  label="In campaign"
                  value={campaignReview.inCampaign}
                  help={REMOVE_FROM_CAMPAIGN_REVIEW_HELP.inCampaign}
                />
                <WorkbenchBulkMetricRow
                  label="Not in campaign"
                  value={campaignReview.notInCampaign}
                  help={REMOVE_FROM_CAMPAIGN_REVIEW_HELP.notInCampaign}
                />
                <WorkbenchBulkMetricRow
                  label="Already removed"
                  value={campaignReview.alreadyRemoved}
                  help={REMOVE_FROM_CAMPAIGN_REVIEW_HELP.alreadyRemoved}
                />
              </WorkbenchBulkMetricsGrid>
            ) : !isSingleCampaign && allReview ? (
              <WorkbenchBulkMetricsGrid>
                {allReview.peopleWithReplies > 0 ? (
                  <Alert
                    variant="warning"
                    message={`${allReview.peopleWithReplies.toLocaleString()} selected ${
                      allReview.peopleWithReplies === 1 ? 'person has' : 'people have'
                    } replies. Removal is permanent for native campaign memberships.`}
                  />
                ) : null}
                {allReview.nativeMembershipsToRemove === 0 ? (
                  <Alert variant="warning" message="No native memberships to remove." />
                ) : null}
                <WorkbenchBulkMetricRow
                  label="People in scope"
                  value={allReview.selectedPeople}
                  help={REMOVE_FROM_ALL_CAMPAIGNS_REVIEW_HELP.peopleInScope}
                />
                <WorkbenchBulkMetricRow
                  label="Native memberships to remove"
                  value={allReview.nativeMembershipsToRemove}
                  help={REMOVE_FROM_ALL_CAMPAIGNS_REVIEW_HELP.nativeMembershipsToRemove}
                />
                <WorkbenchBulkMetricRow
                  label="Smartlead skipped"
                  value={allReview.smartleadMembershipsSkipped}
                  help={REMOVE_FROM_ALL_CAMPAIGNS_REVIEW_HELP.smartleadMembershipsSkipped}
                />
                <WorkbenchBulkMetricRow
                  label="People with replies"
                  value={allReview.peopleWithReplies}
                  help={REMOVE_FROM_ALL_CAMPAIGNS_REVIEW_HELP.peopleWithReplies}
                />
              </WorkbenchBulkMetricsGrid>
            ) : null}
          </>
        ) : null}
      </View>
    </BaseModal>
  );
}
