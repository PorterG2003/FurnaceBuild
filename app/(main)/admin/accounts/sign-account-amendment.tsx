import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DetailPageShell, PageLayout } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Alert, LoadingState, useToast } from '@/components/ui/feedback';
import { WizardFooter } from '@/components/ui/wizard';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';
import { useAccount } from '@/contexts/AccountContext';
import { formatUsd } from '@/components/platform/admin/shared';
import { PlatformInviteLogoEditor } from '@/components/platform/contract/PlatformInviteLogoEditor';
import {
  createPlatformAccountAmendmentDraft,
  getPlatformAccountManagementDetail,
  listPlatformAccountAmendmentRevisions,
  listPlatformAccountAmendments,
  listPlatformTermsVersions,
  publishPlatformAccountAmendment,
  updatePlatformAccountAmendmentDraft,
  type PlatformTermsVersion,
} from '@/lib/supabase/services/platform';
import { sendPlatformAmendmentEmail } from '@/lib/services/platform';
import {
  getAgreementTypeLabel,
  getAgreementTypeTitle,
  getAgreementTemplateMarkdown,
  getAgreementTypeVersion,
  normalizeAgreementType,
  type AgreementType,
} from '@/lib/platform/contract/terms';
import {
  getProposalPlanPreset,
  readProposalPlanTierFromSnapshot,
  type ProposalPlanTier,
} from '@/lib/platform/contract/proposalPlans';
import {
  parseInviteWizardPositiveWholeNumber,
  parseInviteWizardUsdInputToCents,
} from '@/lib/platform/invite/wizard';
import {
  buildAmendmentAcceptUrl,
  isPendingAmendmentStatus,
} from '@/lib/platform/amendment/acceptFlow';
import {
  buildAmendmentWizardStorageKey,
  clampAmendmentWizardStepIndex,
  getAmendmentWizardStepLabel,
  readAmendmentWizardDraft,
  useAmendmentWizardController,
  clearAmendmentWizardDraft,
  writeAmendmentWizardDraft,
  type AmendmentWizardPath,
  type AmendmentWizardStepId,
} from '@/lib/platform/amendment/wizard';
import { useAmendmentReviewPreviewData } from '@/lib/platform/amendment/useAmendmentWizardScreen';
import {
  WizardPageShell,
} from '@/components/platform/admin/wizard';
import { AmendmentPathStep } from '@/components/platform/admin/wizard/steps/amendment/AmendmentPathStep';
import { AmendmentProposalBillingStep } from '@/components/platform/admin/wizard/steps/amendment/AmendmentProposalBillingStep';
import { AmendmentReviewStep } from '@/components/platform/admin/wizard/steps/amendment/AmendmentReviewStep';
import { ContractTermsStep } from '@/components/platform/admin/wizard/steps/shared/ContractTermsStep';
import {
  buildContractProposalSnapshot,
  renderContractTermsPreview,
} from '@/lib/platform/wizard/contract';

const PATH_OPTIONS: Array<{ id: AmendmentWizardPath; label: string; description: string }> = [
  {
    id: 'terms_only',
    label: 'Terms only',
    description: 'Update agreement text without changing plan or billing.',
  },
  {
    id: 'plan_billing',
    label: 'Plan & billing',
    description: 'Change retainer, agreement type, or managed-services proposal.',
  },
  {
    id: 'both',
    label: 'Both',
    description: 'Full contract update: billing, proposal, and terms.',
  },
];

type BaselineContract = {
  monthlyRetainerCents: number;
  agreementType: AgreementType;
  proposalSnapshotJson: Record<string, unknown>;
};

type AmendmentWizardDraft = {
  wizardPath: AmendmentWizardPath;
  stepIndex: number;
  accountName: string;
  monthlyRetainer: string;
  planTier: ProposalPlanTier;
  proposalClientLogoUrl: string;
  proposalClientLogoScale: number;
  proposalClientLogoOffsetX: number;
  websiteTrafficSourcingEnabled: boolean;
  replyHandlingEnabled: boolean;
  agreementType: AgreementType;
  managedOutreachVolume: string;
  managedInboxCount: string;
  selectedTermsVersion: string;
  termsSourceMarkdown: string;
};

export default function SignAccountAmendmentPage() {
  const access = usePlatformAdminAccess();
  const { user: profile } = useAccount();
  const { toast } = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId: string; amendmentId?: string }>();
  const resumeAmendmentId = useMemo(() => {
    const raw = params.amendmentId;
    if (typeof raw === 'string' && raw.length > 0) return raw;
    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].length > 0) return raw[0];
    return null;
  }, [params.amendmentId]);
  const isEditing = resumeAmendmentId != null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blockedByPending, setBlockedByPending] = useState(false);
  const [wizardPath, setWizardPath] = useState<AmendmentWizardPath>('both');
  const [stepIndex, setStepIndex] = useState(0);
  const [termsVersions, setTermsVersions] = useState<PlatformTermsVersion[]>([]);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [accountName, setAccountName] = useState('');
  const [monthlyRetainer, setMonthlyRetainer] = useState('3000');
  const [planTier, setPlanTier] = useState<ProposalPlanTier>('silver');
  const [proposalClientLogoUrl, setProposalClientLogoUrl] = useState('');
  const [proposalClientLogoScale, setProposalClientLogoScale] = useState(1);
  const [proposalClientLogoOffsetX, setProposalClientLogoOffsetX] = useState(0);
  const [websiteTrafficSourcingEnabled, setWebsiteTrafficSourcingEnabled] = useState(true);
  const [replyHandlingEnabled, setReplyHandlingEnabled] = useState(true);
  const [agreementType, setAgreementType] = useState<AgreementType>('managed_services_agreement');
  const [managedOutreachVolume, setManagedOutreachVolume] = useState('5000');
  const [managedInboxCount, setManagedInboxCount] = useState('25');
  const [selectedTermsVersion, setSelectedTermsVersion] = useState('');
  const [termsSourceMarkdown, setTermsSourceMarkdown] = useState('');
  const [amendmentId, setAmendmentId] = useState<string | null>(resumeAmendmentId);
  const baselineRef = useRef<BaselineContract | null>(null);
  const billingStatusRef = useRef<string | null>(null);
  const didHydrateDraftRef = useRef(false);

  const wizardStorageKey = useMemo(
    () =>
      params.accountId
        ? buildAmendmentWizardStorageKey(params.accountId, amendmentId)
        : null,
    [amendmentId, params.accountId],
  );

  const isManagedServices = agreementType === 'managed_services_agreement';
  const monthlyRetainerCents = parseInviteWizardUsdInputToCents(monthlyRetainer);
  const managedOutreachVolumeValue = parseInviteWizardPositiveWholeNumber(managedOutreachVolume);
  const managedInboxCountValue = parseInviteWizardPositiveWholeNumber(managedInboxCount);
  const currentPlanPreset = useMemo(() => getProposalPlanPreset(planTier), [planTier]);
  const { steps: visibleStepIds, goBack, goNext, goToStep } = useAmendmentWizardController({
    path: wizardPath,
    stepIndex,
    draft: {
      agreementType,
      monthlyRetainer,
      managedOutreachVolume,
      managedInboxCount,
      termsSourceMarkdown,
    },
    setStepIndex,
    onValidationError: toast.error,
  });
  const stepLabels = visibleStepIds.map((step) => getAmendmentWizardStepLabel(step));
  const currentStepId =
    visibleStepIds[Math.min(stepIndex, visibleStepIds.length - 1)] ?? 'path';

  const proposalSnapshot = useMemo(() => {
    return buildContractProposalSnapshot({
      agreementType,
      planTier,
      clientLogoUrl: proposalClientLogoUrl,
      clientLogoScale: proposalClientLogoScale,
      clientLogoOffsetX: proposalClientLogoOffsetX,
      websiteTrafficSourcingEnabled,
      replyHandlingEnabled,
      managedOutreachVolume: managedOutreachVolumeValue,
      managedInboxCount: managedInboxCountValue,
    });
  }, [
    agreementType,
    managedInboxCountValue,
    managedOutreachVolumeValue,
    planTier,
    proposalClientLogoOffsetX,
    proposalClientLogoScale,
    proposalClientLogoUrl,
    replyHandlingEnabled,
    websiteTrafficSourcingEnabled,
  ]);

  const effectiveContract = useMemo(() => {
    const baseline = baselineRef.current;
    if (wizardPath === 'terms_only' && baseline) {
      return {
        monthlyRetainerCents: baseline.monthlyRetainerCents,
        agreementType: baseline.agreementType,
        proposalSnapshotJson: baseline.proposalSnapshotJson,
      };
    }
    return {
      monthlyRetainerCents: monthlyRetainerCents ?? 0,
      agreementType,
      proposalSnapshotJson: proposalSnapshot,
    };
  }, [agreementType, monthlyRetainerCents, proposalSnapshot, wizardPath]);

  const renderedTerms = useMemo(() => {
    if (!termsSourceMarkdown.trim() || effectiveContract.monthlyRetainerCents <= 0) return '';
    return renderContractTermsPreview({
      sourceMarkdown: termsSourceMarkdown,
      proposedAccountName: accountName,
      monthlyRetainerCents: effectiveContract.monthlyRetainerCents,
      proposalSnapshot: effectiveContract.proposalSnapshotJson,
    });
  }, [accountName, effectiveContract, termsSourceMarkdown]);

  const reviewPreviewData = useAmendmentReviewPreviewData({
    ownerEmail,
    accountName,
    monthlyRetainerCents: effectiveContract.monthlyRetainerCents,
    proposalSnapshot: effectiveContract.proposalSnapshotJson,
    agreementType: effectiveContract.agreementType,
    selectedTermsVersion,
    termsSourceMarkdown,
    renderedTermsPreview: renderedTerms,
    amendmentId: amendmentId ?? undefined,
    inviterName: profile?.name || profile?.email || 'Furnace',
    status: 'pending_acceptance',
  });

  const termsTemplatesByType = useMemo(() => {
    const byType = {
      platform_agreement: null,
      managed_services_agreement: null,
    } as Record<AgreementType, PlatformTermsVersion | null>;
    for (const type of Object.keys(byType) as AgreementType[]) {
      byType[type] =
        termsVersions.find((item) => item.agreement_type === type && item.is_default) ??
        termsVersions.find((item) => item.agreement_type === type) ??
        null;
    }
    return byType;
  }, [termsVersions]);

  const applyAgreementType = (nextAgreementType: AgreementType) => {
    setAgreementType(nextAgreementType);
    const template = termsTemplatesByType[nextAgreementType];
    if (template) {
      setSelectedTermsVersion(template.version);
      setTermsSourceMarkdown(template.body_markdown);
    } else {
      setSelectedTermsVersion(getAgreementTypeVersion(nextAgreementType));
      setTermsSourceMarkdown(getAgreementTemplateMarkdown(nextAgreementType));
    }
  };

  const applyPlanTier = (nextTier: ProposalPlanTier) => {
    setPlanTier(nextTier);
  };

  const applyWizardDraft = useCallback((draft: AmendmentWizardDraft) => {
    setWizardPath(draft.wizardPath);
    setAccountName(draft.accountName);
    setMonthlyRetainer(draft.monthlyRetainer);
    setPlanTier(draft.planTier);
    setProposalClientLogoUrl(draft.proposalClientLogoUrl);
    setProposalClientLogoScale(draft.proposalClientLogoScale);
    setProposalClientLogoOffsetX(draft.proposalClientLogoOffsetX);
    setWebsiteTrafficSourcingEnabled(draft.websiteTrafficSourcingEnabled);
    setReplyHandlingEnabled(draft.replyHandlingEnabled);
    setAgreementType(draft.agreementType);
    setManagedOutreachVolume(draft.managedOutreachVolume);
    setManagedInboxCount(draft.managedInboxCount);
    setSelectedTermsVersion(draft.selectedTermsVersion);
    setTermsSourceMarkdown(draft.termsSourceMarkdown);
    setStepIndex(clampAmendmentWizardStepIndex(draft.wizardPath, draft.stepIndex));
  }, []);

  const load = useCallback(async () => {
    if (!params.accountId) return;
    setLoading(true);
    try {
      const [detail, terms, amendments] = await Promise.all([
        getPlatformAccountManagementDetail({ recordId: params.accountId, recordKind: 'account' }),
        listPlatformTermsVersions(),
        listPlatformAccountAmendments(params.accountId),
      ]);
      setTermsVersions(terms);

      const pending = amendments.find((item) => isPendingAmendmentStatus(item.status));
      if (pending && (!amendmentId || pending.id !== amendmentId)) {
        setBlockedByPending(true);
        return;
      }

      const acct = detail.account as { name?: string } | null;
      const billing = detail.billing;
      const owner = (detail.team_members ?? []).find(
        (m) => (m as { is_owner?: boolean }).is_owner,
      ) as { email?: string } | undefined;
      setAccountName(typeof acct?.name === 'string' ? acct.name : '');
      setOwnerEmail(typeof owner?.email === 'string' ? owner.email : '');

      const contractAgreement = normalizeAgreementType(
        (billing as { agreement_type?: AgreementType } | null)?.agreement_type ??
          'managed_services_agreement',
      );
      const retainerCents = billing?.monthly_retainer_cents ?? 300000;
      billingStatusRef.current =
        typeof billing?.billing_status === 'string' ? billing.billing_status : null;
      const proposalJson =
        (billing as { proposal_snapshot_json?: Record<string, unknown> } | null)
          ?.proposal_snapshot_json ?? {};

      baselineRef.current = {
        monthlyRetainerCents: retainerCents,
        agreementType: contractAgreement,
        proposalSnapshotJson: proposalJson,
      };

      setMonthlyRetainer(String(Math.round(retainerCents / 100)));
      setAgreementType(contractAgreement);
      setPlanTier(readProposalPlanTierFromSnapshot(proposalJson, 'silver'));
      if (typeof proposalJson.client_logo_url === 'string') {
        setProposalClientLogoUrl(proposalJson.client_logo_url);
      }
      if (typeof proposalJson.website_traffic_sourcing_enabled === 'boolean') {
        setWebsiteTrafficSourcingEnabled(proposalJson.website_traffic_sourcing_enabled);
      }
      if (typeof proposalJson.reply_handling_enabled === 'boolean') {
        setReplyHandlingEnabled(proposalJson.reply_handling_enabled);
      }
      if (proposalJson.managed_outreach_volume != null) {
        setManagedOutreachVolume(String(proposalJson.managed_outreach_volume));
      }
      if (proposalJson.managed_inbox_count != null) {
        setManagedInboxCount(String(proposalJson.managed_inbox_count));
      }

      const defaultTerms =
        terms.find((t) => t.agreement_type === contractAgreement && t.is_default) ??
        terms.find((t) => t.agreement_type === contractAgreement);
      if (defaultTerms) {
        setSelectedTermsVersion(defaultTerms.version);
        setTermsSourceMarkdown(defaultTerms.body_markdown);
      }

      if (resumeAmendmentId) {
        const revisions = await listPlatformAccountAmendmentRevisions(resumeAmendmentId);
        const current =
          revisions.find((item) => item.is_current) ??
          revisions[revisions.length - 1];
        if (current) {
          setAccountName(current.account_name);
          setMonthlyRetainer(String(Math.round(current.monthly_retainer_cents / 100)));
          setAgreementType(normalizeAgreementType(current.agreement_type));
          setSelectedTermsVersion(current.terms_version);
          setTermsSourceMarkdown(current.terms_snapshot_markdown);
          const snap = current.proposal_snapshot_json ?? {};
          setPlanTier(readProposalPlanTierFromSnapshot(snap, 'silver'));
          if (typeof snap.client_logo_url === 'string') {
            setProposalClientLogoUrl(snap.client_logo_url);
          }
          if (typeof snap.website_traffic_sourcing_enabled === 'boolean') {
            setWebsiteTrafficSourcingEnabled(snap.website_traffic_sourcing_enabled);
          }
          if (typeof snap.reply_handling_enabled === 'boolean') {
            setReplyHandlingEnabled(snap.reply_handling_enabled);
          }
          if (snap.managed_outreach_volume != null) {
            setManagedOutreachVolume(String(snap.managed_outreach_volume));
          }
          if (snap.managed_inbox_count != null) {
            setManagedInboxCount(String(snap.managed_inbox_count));
          }
        }
      }

      if (!didHydrateDraftRef.current && wizardStorageKey) {
        const stored = readAmendmentWizardDraft<AmendmentWizardDraft>(wizardStorageKey);
        if (stored) applyWizardDraft(stored);
        didHydrateDraftRef.current = true;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load account.');
    } finally {
      setLoading(false);
    }
  }, [applyWizardDraft, params.accountId, resumeAmendmentId, wizardStorageKey]);

  useEffect(() => {
    if (access === 'allowed' && params.accountId) void load();
  }, [access, load, params.accountId]);

  useEffect(() => {
    if (!wizardStorageKey || loading) return;
    writeAmendmentWizardDraft(wizardStorageKey, {
      wizardPath,
      stepIndex,
      accountName,
      monthlyRetainer,
      planTier,
      proposalClientLogoUrl,
      proposalClientLogoScale,
      proposalClientLogoOffsetX,
      websiteTrafficSourcingEnabled,
      replyHandlingEnabled,
      agreementType,
      managedOutreachVolume,
      managedInboxCount,
      selectedTermsVersion,
      termsSourceMarkdown,
    });
  }, [
    accountName,
    agreementType,
    loading,
    managedInboxCount,
    managedOutreachVolume,
    monthlyRetainer,
    planTier,
    proposalClientLogoOffsetX,
    proposalClientLogoScale,
    proposalClientLogoUrl,
    replyHandlingEnabled,
    selectedTermsVersion,
    stepIndex,
    termsSourceMarkdown,
    websiteTrafficSourcingEnabled,
    wizardPath,
    wizardStorageKey,
  ]);

  const persistDraft = async () => {
    if (!params.accountId) throw new Error('Missing account.');
    const retainer = effectiveContract.monthlyRetainerCents;
    if (retainer <= 0) throw new Error('Enter a valid monthly retainer.');
    if (!termsSourceMarkdown.trim()) throw new Error('Terms content is required.');

    const payload = {
      accountName: accountName.trim() || 'Account',
      monthlyRetainerCents: retainer,
      proposalSnapshotJson: effectiveContract.proposalSnapshotJson,
      agreementType: effectiveContract.agreementType,
      termsVersion: selectedTermsVersion,
      termsSourceMarkdown,
    };

    if (amendmentId) {
      return updatePlatformAccountAmendmentDraft({ amendmentId, ...payload });
    }
    const created = await createPlatformAccountAmendmentDraft({
      accountId: params.accountId,
      ...payload,
    });
    if (params.accountId && wizardStorageKey) {
      clearAmendmentWizardDraft(
        buildAmendmentWizardStorageKey(params.accountId, null),
      );
    }
    setAmendmentId(created.id);
    return created;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await persistDraft();
      if (wizardStorageKey) {
        clearAmendmentWizardDraft(wizardStorageKey);
      }
      toast.success('Amendment draft saved.');
      router.replace({
        pathname: '/admin/accounts/[id]',
        params: { id: params.accountId!, kind: 'account' },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    const baselineRetainer = baselineRef.current?.monthlyRetainerCents ?? 0;
    if (
      billingStatusRef.current === 'payment_required' &&
      effectiveContract.monthlyRetainerCents > baselineRetainer
    ) {
      toast.error(
        'This account has a failed payment. Resolve billing before publishing a retainer increase.',
      );
      return;
    }

    setSaving(true);
    try {
      const amendment = await persistDraft();
      await publishPlatformAccountAmendment(amendment.id);
      if (!ownerEmail.trim()) throw new Error('Account owner email not found.');
      await sendPlatformAmendmentEmail({
        to: ownerEmail.trim().toLowerCase(),
        inviterName: profile?.name || profile?.email || 'Furnace',
        acceptUrl: buildAmendmentAcceptUrl(amendment.id),
        accountName: accountName.trim() || undefined,
      });
      if (wizardStorageKey) {
        clearAmendmentWizardDraft(wizardStorageKey);
      }
      if (params.accountId) {
        clearAmendmentWizardDraft(buildAmendmentWizardStorageKey(params.accountId, null));
      }
      toast.success('Amendment published. Owner was emailed.');
      router.replace({
        pathname: '/admin/accounts/[id]',
        params: { id: params.accountId!, kind: 'account' },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish amendment.');
    } finally {
      setSaving(false);
    }
  };

  const renderStepContent = (stepId: AmendmentWizardStepId) => {
    if (stepId === 'path') {
      return (
        <AmendmentPathStep
          options={PATH_OPTIONS}
          wizardPath={wizardPath}
          onSelect={(nextPath) => {
            setWizardPath(nextPath);
            setStepIndex(0);
          }}
        />
      );
    }

    if (stepId === 'proposal_billing') {
      return (
        <AmendmentProposalBillingStep
          accountName={accountName}
          onAccountNameChange={setAccountName}
          agreementType={agreementType}
          onAgreementTypeChange={applyAgreementType}
          monthlyRetainer={monthlyRetainer}
          onMonthlyRetainerChange={setMonthlyRetainer}
          ownerEmail={ownerEmail}
          isManagedServices={isManagedServices}
          planTier={planTier}
          onPlanTierChange={applyPlanTier}
          websiteTrafficSourcingEnabled={websiteTrafficSourcingEnabled}
          onWebsiteTrafficSourcingEnabledChange={setWebsiteTrafficSourcingEnabled}
          replyHandlingEnabled={replyHandlingEnabled}
          onReplyHandlingEnabledChange={setReplyHandlingEnabled}
          managedOutreachVolume={managedOutreachVolume}
          onManagedOutreachVolumeChange={setManagedOutreachVolume}
          managedInboxCount={managedInboxCount}
          onManagedInboxCountChange={setManagedInboxCount}
        />
      );
    }

    if (stepId === 'terms') {
      return (
        <ContractTermsStep
          title={getAgreementTypeTitle(agreementType)}
          templateLabel={`Template: ${selectedTermsVersion || 'Custom'}`}
          markdown={termsSourceMarkdown}
          onMarkdownChange={setTermsSourceMarkdown}
          previewMarkdown={renderedTerms}
          placeholder="Paste or edit agreement markdown"
        />
      );
    }

    const summaryLines = [
      { label: 'Owner', value: ownerEmail || 'Missing email' },
      { label: 'Retainer', value: formatUsd(effectiveContract.monthlyRetainerCents) },
      { label: 'Agreement', value: getAgreementTypeLabel(effectiveContract.agreementType) },
    ];

    if (isManagedServices) {
      summaryLines.push({ label: 'Plan', value: currentPlanPreset.label });
    }

    return (
      <AmendmentReviewStep
        message="Preview the owner acceptance experience below. Publishing emails the account owner; billing changes apply after they accept."
        summaryLines={summaryLines}
        reviewPreviewData={reviewPreviewData}
        saving={saving}
        onBack={goBack}
        onSaveDraft={() => void handleSaveDraft()}
        onPublish={() => void handlePublish()}
      >
        <PlatformInviteLogoEditor
          logoUrl={proposalClientLogoUrl}
          logoScale={proposalClientLogoScale}
          logoOffsetX={proposalClientLogoOffsetX}
          onLogoUrlChange={setProposalClientLogoUrl}
          onLogoScaleChange={setProposalClientLogoScale}
          onLogoOffsetChange={setProposalClientLogoOffsetX}
        />
      </AmendmentReviewStep>
    );
  };

  if (access === 'loading' || loading) {
    return (
      <PageLayout>
        <LoadingState message="Loading amendment wizard..." />
      </PageLayout>
    );
  }

  if (access !== 'allowed') {
    return (
      <PageLayout>
        <Alert variant="error" message="You do not have access to admin tools." />
      </PageLayout>
    );
  }

  if (blockedByPending) {
    return (
      <PageLayout>
        <DetailPageShell
          breadcrumbItems={[
            { label: 'Admin', href: '/admin' },
            { label: 'Account Management', href: '/admin/accounts' },
          ]}
          backHref={params.accountId ? `/admin/accounts/${params.accountId}?kind=account` : '/admin/accounts'}
          title="Amendment in progress"
        >
          <Alert
            variant="warning"
            message="This account already has a published amendment awaiting owner acceptance. Resolve or cancel it before starting another change."
          />
        </DetailPageShell>
      </PageLayout>
    );
  }

  const isReviewStep = currentStepId === 'review';

  return (
    <WizardPageShell
      breadcrumbItems={[
        { label: 'Admin', href: '/admin' },
        { label: 'Account Management', href: '/admin/accounts' },
        { label: isEditing ? 'Edit amendment' : 'Manage contract & billing' },
      ]}
      backHref={params.accountId ? `/admin/accounts/${params.accountId}?kind=account` : '/admin/accounts'}
      title={isEditing ? 'Edit account amendment' : 'Manage contract & billing'}
      subtitle={accountName || ownerEmail}
      steps={stepLabels}
      activeStepIndex={stepIndex}
      onStepPress={goToStep}
      footer={
        isReviewStep ? undefined : (
          <WizardFooter>
            <Button
              variant="outline"
              disabled={stepIndex === 0 || saving}
              onPress={goBack}
              fullWidth
            >
              Back
            </Button>
            <Button fullWidth onPress={goNext}>
              Continue
            </Button>
          </WizardFooter>
        )
      }
    >
      {renderStepContent(currentStepId)}
    </WizardPageShell>
  );
}
