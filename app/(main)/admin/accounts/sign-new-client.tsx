import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PageLayout } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Alert, LoadingState, useToast } from '@/components/ui/feedback';
import { WizardFooter } from '@/components/ui/wizard';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';
import { useAccount } from '@/contexts/AccountContext';
import { normalizeProposalSnapshot } from '@/components/platform/admin/shared';
import { PlatformInviteLogoEditor } from '@/components/platform/contract/PlatformInviteLogoEditor';
import {
  getProposalPlanPreset,
  isProposalPlanTier,
  readProposalPlanTierFromSnapshot,
  type ProposalPlanTier,
} from '@/lib/platform/contract/proposalPlans';
import {
  createPlatformInvitationDraft,
  getPlatformAccountManagementDetail,
  listPlatformTermsVersions,
  publishPlatformInvitation,
  updatePlatformInvitationDraft,
  type PlatformTermsVersion,
} from '@/lib/supabase/services/platform';
import { sendPlatformInviteEmail } from '@/lib/services/platform';
import {
  getAgreementTemplateMarkdown,
  getAgreementTypeLabel,
  getAgreementTypeTitle,
  getAgreementTypeVersion,
  normalizeAgreementType,
  type AgreementType,
} from '@/lib/platform/contract/terms';
import {
  buildPlatformInviteWizardStorageKey,
  clampInviteWizardStepIndex,
  clearPlatformInviteWizardDraft,
  parseInviteWizardPositiveWholeNumber,
  parseInviteWizardUsdInputToCents,
  readPlatformInviteWizardDraft,
  type PlatformInviteWizardDraft,
  useInviteWizardController,
  writePlatformInviteWizardDraft,
} from '@/lib/platform/invite/wizard';
import { useInviteReviewPreviewData } from '@/lib/platform/invite/useInviteWizardScreen';
import { WizardPageShell } from '@/components/platform/admin/wizard';
import { InviteClientStep } from '@/components/platform/admin/wizard/steps/invite/InviteClientStep';
import { InviteProposalBillingStep } from '@/components/platform/admin/wizard/steps/invite/InviteProposalBillingStep';
import { InviteReviewStep } from '@/components/platform/admin/wizard/steps/invite/InviteReviewStep';
import { InviteApprovalStep } from '@/components/platform/admin/wizard/steps/invite/InviteApprovalStep';
import { ContractTermsStep } from '@/components/platform/admin/wizard/steps/shared/ContractTermsStep';
import {
  buildContractProposalSnapshot,
  renderContractTermsPreview,
} from '@/lib/platform/wizard/contract';

const defaultPlanTier: ProposalPlanTier = 'silver';

function buildInviteUrl(invitationId: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://build.getfurnace.io';
  return `${origin}/accept-platform-invite/${invitationId}`;
}

export default function SignNewClientPage() {
  const access = usePlatformAdminAccess();
  const { user: profile } = useAccount();
  const { toast } = useToast();
  const showSuccessToast = toast.success;
  const showErrorToast = toast.error;
  const router = useRouter();
  const params = useLocalSearchParams<{ invitationId?: string }>();
  const isEditing = typeof params.invitationId === 'string' && params.invitationId.length > 0;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [termsVersions, setTermsVersions] = useState<PlatformTermsVersion[]>([]);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCompanyName, setInviteCompanyName] = useState('');
  const [inviteMonthlyRetainer, setInviteMonthlyRetainer] = useState('');
  const [planTier, setPlanTier] = useState<ProposalPlanTier>(defaultPlanTier);
  const [proposalClientLogoUrl, setProposalClientLogoUrl] = useState('');
  const [proposalClientLogoScale, setProposalClientLogoScale] = useState(1);
  const [proposalClientLogoOffsetX, setProposalClientLogoOffsetX] = useState(0);
  const [websiteTrafficSourcingEnabled, setWebsiteTrafficSourcingEnabled] = useState(false);
  const [replyHandlingEnabled, setReplyHandlingEnabled] = useState(false);
  const [agreementType, setAgreementType] = useState<AgreementType>('platform_agreement');
  const [managedOutreachVolume, setManagedOutreachVolume] = useState('');
  const [managedInboxCount, setManagedInboxCount] = useState('');
  const [selectedTermsVersion, setSelectedTermsVersion] = useState<string>('');
  const [termsSourceMarkdown, setTermsSourceMarkdown] = useState('');
  const [autoAddInternalAdmins, setAutoAddInternalAdmins] = useState(true);
  const didHydrateDraftRef = useRef(false);
  const isApplyingDraftRef = useRef(false);
  const wizardStorageKey = useMemo(
    () => buildPlatformInviteWizardStorageKey(isEditing ? params.invitationId : undefined),
    [isEditing, params.invitationId],
  );
  const monthlyRetainerCents = useMemo(
    () => parseInviteWizardUsdInputToCents(inviteMonthlyRetainer),
    [inviteMonthlyRetainer],
  );
  const managedOutreachVolumeValue = useMemo(
    () => parseInviteWizardPositiveWholeNumber(managedOutreachVolume),
    [managedOutreachVolume],
  );
  const managedInboxCountValue = useMemo(
    () => parseInviteWizardPositiveWholeNumber(managedInboxCount),
    [managedInboxCount],
  );

  const proposalSnapshot = useMemo(
    () =>
      buildContractProposalSnapshot({
        agreementType,
        planTier,
        clientLogoUrl: proposalClientLogoUrl,
        clientLogoScale: proposalClientLogoScale,
        clientLogoOffsetX: proposalClientLogoOffsetX,
        websiteTrafficSourcingEnabled,
        replyHandlingEnabled,
        managedOutreachVolume: managedOutreachVolumeValue,
        managedInboxCount: managedInboxCountValue,
      }),
    [
      agreementType,
      managedInboxCountValue,
      managedOutreachVolumeValue,
      planTier,
      proposalClientLogoOffsetX,
      proposalClientLogoScale,
      proposalClientLogoUrl,
      replyHandlingEnabled,
      websiteTrafficSourcingEnabled,
    ],
  );

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

  const fallbackTermsTemplatesByType = useMemo(
    () =>
      ({
        platform_agreement: {
          version: getAgreementTypeVersion('platform_agreement'),
          title: getAgreementTypeTitle('platform_agreement'),
          body_markdown: getAgreementTemplateMarkdown('platform_agreement'),
        },
        managed_services_agreement: {
          version: getAgreementTypeVersion('managed_services_agreement'),
          title: getAgreementTypeTitle('managed_services_agreement'),
          body_markdown: getAgreementTemplateMarkdown('managed_services_agreement'),
        },
      }) as Record<
        AgreementType,
        Pick<PlatformTermsVersion, 'version' | 'title' | 'body_markdown'>
      >,
    [],
  );

  const selectedTerms = useMemo(
    () =>
      termsVersions.find((item) => item.version === selectedTermsVersion) ??
      termsTemplatesByType[agreementType] ??
      fallbackTermsTemplatesByType[agreementType],
    [agreementType, fallbackTermsTemplatesByType, selectedTermsVersion, termsTemplatesByType, termsVersions],
  );
  const currentPlanPreset = useMemo(() => getProposalPlanPreset(planTier), [planTier]);
  const renderedTermsPreview = useMemo(
    () =>
      renderContractTermsPreview({
        sourceMarkdown: termsSourceMarkdown,
        proposedAccountName: inviteCompanyName.trim() || null,
        monthlyRetainerCents: monthlyRetainerCents ?? 0,
        proposalSnapshot,
      }),
    [inviteCompanyName, monthlyRetainerCents, proposalSnapshot, termsSourceMarkdown],
  );
  const isManagedServicesAgreement = agreementType === 'managed_services_agreement';
  const currentWizardDraft = useMemo<PlatformInviteWizardDraft>(
    () => ({
      stepIndex,
      inviteEmail,
      inviteCompanyName,
      inviteMonthlyRetainer,
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
      autoAddInternalAdmins,
    }),
    [
      agreementType,
      autoAddInternalAdmins,
      inviteCompanyName,
      inviteEmail,
      inviteMonthlyRetainer,
      managedInboxCount,
      managedOutreachVolume,
      planTier,
      proposalClientLogoOffsetX,
      proposalClientLogoScale,
      proposalClientLogoUrl,
      replyHandlingEnabled,
      selectedTermsVersion,
      stepIndex,
      termsSourceMarkdown,
      websiteTrafficSourcingEnabled,
    ],
  );
  const { steps, goBack, goNext, goToStep } = useInviteWizardController({
    agreementType,
    stepIndex,
    draft: {
      inviteEmail,
      inviteMonthlyRetainer,
      agreementType,
      managedOutreachVolume,
      managedInboxCount,
      termsSourceMarkdown,
    },
    setStepIndex,
    onValidationError: showErrorToast,
  });

  const applyWizardDraft = useCallback((draft: PlatformInviteWizardDraft) => {
    isApplyingDraftRef.current = true;
    setInviteEmail(draft.inviteEmail);
    setInviteCompanyName(draft.inviteCompanyName);
    setInviteMonthlyRetainer(draft.inviteMonthlyRetainer);
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
    setAutoAddInternalAdmins(draft.autoAddInternalAdmins);
    setStepIndex(clampInviteWizardStepIndex(draft.stepIndex, draft.agreementType));
    setTimeout(() => {
      isApplyingDraftRef.current = false;
    }, 0);
  }, []);

  const applyPlanTier = (nextTier: ProposalPlanTier) => {
    setPlanTier(nextTier);
  };

  const applyAgreementType = (nextAgreementType: AgreementType) => {
    setAgreementType(nextAgreementType);
    const nextTemplate =
      termsTemplatesByType[nextAgreementType] ?? fallbackTermsTemplatesByType[nextAgreementType];
    setSelectedTermsVersion(nextTemplate?.version ?? '');
    setTermsSourceMarkdown(nextTemplate?.body_markdown ?? '');
  };

  useEffect(() => {
    if (access !== 'allowed') return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [termsResult, detailResult] = await Promise.allSettled([
          listPlatformTermsVersions(),
          isEditing
            ? getPlatformAccountManagementDetail({
                recordId: params.invitationId!,
                recordKind: 'invitation',
              })
            : Promise.resolve(null),
        ]);
        const terms = termsResult.status === 'fulfilled' ? termsResult.value : [];
        const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;

        if (cancelled) return;
        if (termsResult.status === 'rejected') {
          showErrorToast(
            termsResult.reason instanceof Error
              ? termsResult.reason.message
              : 'Failed to load agreement templates from Supabase. Using built-in defaults.'
          );
        }
        if (detailResult.status === 'rejected') {
          throw detailResult.reason;
        }
        setTermsVersions(terms);
        const defaultPlatformTemplate =
          terms.find((item) => item.agreement_type === 'platform_agreement' && item.is_default) ??
          terms.find((item) => item.agreement_type === 'platform_agreement') ??
          terms[0] ??
          fallbackTermsTemplatesByType.platform_agreement;

        const defaultDraft: PlatformInviteWizardDraft = {
          stepIndex: 0,
          inviteEmail: '',
          inviteCompanyName: '',
          inviteMonthlyRetainer: '',
          planTier: defaultPlanTier,
          proposalClientLogoUrl: '',
          proposalClientLogoScale: 1,
          proposalClientLogoOffsetX: 0,
          websiteTrafficSourcingEnabled: false,
          replyHandlingEnabled: false,
          agreementType: 'platform_agreement',
          managedOutreachVolume: '',
          managedInboxCount: '',
          selectedTermsVersion: defaultPlatformTemplate?.version || '',
          termsSourceMarkdown: defaultPlatformTemplate?.body_markdown || '',
          autoAddInternalAdmins: true,
        };

        let nextDraft = defaultDraft;

        if (detail?.invitation) {
          const invitation = detail.invitation as Record<string, unknown>;
          const revisions = detail.revisions ?? [];
          const currentRevision =
            revisions.find((revision) => revision.is_current) ?? revisions[0] ?? null;
          const proposal = normalizeProposalSnapshot(currentRevision?.proposal_snapshot_json);
          const rawProposal =
            currentRevision?.proposal_snapshot_json &&
            typeof currentRevision.proposal_snapshot_json === 'object'
              ? (currentRevision.proposal_snapshot_json as Record<string, unknown>)
              : {};
          const loadedPlanTier = readProposalPlanTierFromSnapshot(rawProposal, defaultPlanTier);
          const loadedAgreementType = normalizeAgreementType(
            currentRevision?.agreement_type ?? invitation.agreement_type
          );
          const loadedTermsVersion =
            typeof currentRevision?.terms_version === 'string'
              ? currentRevision.terms_version
              : typeof invitation.terms_version === 'string'
                ? invitation.terms_version
                : terms.find((item) => item.agreement_type === loadedAgreementType && item.is_default)?.version ||
                  terms.find((item) => item.agreement_type === loadedAgreementType)?.version ||
                  fallbackTermsTemplatesByType[loadedAgreementType].version;
          const loadedTermsSourceMarkdown =
            typeof currentRevision?.terms_source_markdown === 'string' && currentRevision.terms_source_markdown.trim()
              ? currentRevision.terms_source_markdown
              : terms.find((item) => item.version === loadedTermsVersion)?.body_markdown ||
                terms.find((item) => item.agreement_type === loadedAgreementType && item.is_default)?.body_markdown ||
                fallbackTermsTemplatesByType[loadedAgreementType].body_markdown;

          nextDraft = {
            stepIndex: 0,
            inviteEmail: typeof invitation.email === 'string' ? invitation.email : '',
            inviteCompanyName:
              typeof invitation.proposed_account_name === 'string' ? invitation.proposed_account_name : '',
            inviteMonthlyRetainer:
              typeof invitation.monthly_retainer_cents === 'number'
                ? String(Math.round(invitation.monthly_retainer_cents / 100))
                : '',
            planTier: loadedPlanTier,
            proposalClientLogoUrl: proposal.client_logo_url,
            proposalClientLogoScale: proposal.client_logo_scale,
            proposalClientLogoOffsetX: proposal.client_logo_offset_x,
            websiteTrafficSourcingEnabled: proposal.website_traffic_sourcing_enabled,
            replyHandlingEnabled: proposal.reply_handling_enabled,
            agreementType: loadedAgreementType,
            managedOutreachVolume:
              typeof proposal.managed_outreach_volume === 'number' ? String(proposal.managed_outreach_volume) : '',
            managedInboxCount:
              typeof proposal.managed_inbox_count === 'number' ? String(proposal.managed_inbox_count) : '',
            selectedTermsVersion: loadedTermsVersion,
            termsSourceMarkdown: loadedTermsSourceMarkdown,
            autoAddInternalAdmins: Boolean(invitation.auto_add_internal_admins),
          };
        }

        const localDraft = readPlatformInviteWizardDraft(wizardStorageKey);
        if (localDraft) {
          nextDraft = {
            ...nextDraft,
            ...localDraft,
            agreementType: normalizeAgreementType(localDraft.agreementType),
            planTier: isProposalPlanTier(localDraft.planTier) ? localDraft.planTier : nextDraft.planTier,
          };
        }

        applyWizardDraft(nextDraft);
        didHydrateDraftRef.current = true;
      } catch (err) {
        if (!cancelled) {
          showErrorToast(err instanceof Error ? err.message : 'Failed to load client signing wizard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [access, applyWizardDraft, fallbackTermsTemplatesByType, isEditing, params.invitationId, showErrorToast, wizardStorageKey]);

  useEffect(() => {
    if (!didHydrateDraftRef.current || loading || isApplyingDraftRef.current) return;
    writePlatformInviteWizardDraft(wizardStorageKey, currentWizardDraft);
  }, [currentWizardDraft, loading, wizardStorageKey]);

  const saveDraft = async () => {
    if (
      !inviteEmail.trim() ||
      monthlyRetainerCents == null ||
      monthlyRetainerCents < 0 ||
      !termsSourceMarkdown.trim()
    ) {
      throw new Error('Complete the required fields before saving.');
    }
    if (isManagedServicesAgreement && (managedOutreachVolumeValue == null || managedInboxCountValue == null)) {
      throw new Error('Managed services invites require outreach volume and inbox count.');
    }

    if (isEditing) {
      return updatePlatformInvitationDraft({
        invitationId: params.invitationId!,
        email: inviteEmail.trim().toLowerCase(),
        proposedAccountName: inviteCompanyName.trim() || null,
        monthlyRetainerCents,
        proposalSnapshotJson: proposalSnapshot,
        agreementType,
        termsVersion: selectedTermsVersion,
        termsSourceMarkdown,
        autoAddInternalAdmins,
      });
    }

    return createPlatformInvitationDraft({
      email: inviteEmail.trim().toLowerCase(),
      proposedAccountName: inviteCompanyName.trim() || null,
      monthlyRetainerCents,
      proposalSnapshotJson: proposalSnapshot,
      agreementType,
      termsVersion: selectedTermsVersion,
      termsSourceMarkdown,
      autoAddInternalAdmins,
    });
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const invitation = await saveDraft();
      clearPlatformInviteWizardDraft(wizardStorageKey);
      showSuccessToast('Draft saved.');
      router.replace({
        pathname: '/admin/accounts/[id]',
        params: { id: invitation.id, kind: 'invitation' },
      });
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishToClient = async () => {
    setSaving(true);
    try {
      const invitation = await saveDraft();
      await publishPlatformInvitation(invitation.id);
      const proposalRecord =
        proposalSnapshot && typeof proposalSnapshot === 'object'
          ? (proposalSnapshot as Record<string, unknown>)
          : {};
      await sendPlatformInviteEmail({
        to: inviteEmail.trim().toLowerCase(),
        inviterName: profile?.name || profile?.email || 'Furnace',
        monthlyRetainerCents: monthlyRetainerCents ?? 0,
        acceptUrl: buildInviteUrl(invitation.id),
        proposalTitle:
          typeof proposalRecord.proposal_title === 'string'
            ? proposalRecord.proposal_title
            : agreementType === 'managed_services_agreement'
              ? getProposalPlanPreset(planTier).proposalTitle
              : 'Furnace Platform Access',
        accountName: inviteCompanyName.trim() || undefined,
      });
      clearPlatformInviteWizardDraft(wizardStorageKey);
      showSuccessToast('Invite published to client.');
      router.replace({
        pathname: '/admin/accounts/[id]',
        params: { id: invitation.id, kind: 'invitation' },
      });
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to publish invite.');
    } finally {
      setSaving(false);
    }
  };

  const reviewPreviewData = useInviteReviewPreviewData({
    inviteEmail,
    inviteCompanyName,
    monthlyRetainerCents,
    proposalSnapshot,
    agreementType,
    selectedTermsVersion,
    termsSourceMarkdown,
    renderedTermsPreview,
    invitationId: params.invitationId,
    isEditing,
  });

  const renderStepBody = () => {
    if (stepIndex === 0) {
      return (
        <InviteClientStep
          inviteEmail={inviteEmail}
          onInviteEmailChange={setInviteEmail}
          inviteCompanyName={inviteCompanyName}
          onInviteCompanyNameChange={setInviteCompanyName}
        />
      );
    }

    if (stepIndex === 1) {
      return (
        <InviteProposalBillingStep
          agreementType={agreementType}
          onAgreementTypeChange={applyAgreementType}
          isManagedServices={isManagedServicesAgreement}
          inviteMonthlyRetainer={inviteMonthlyRetainer}
          onInviteMonthlyRetainerChange={setInviteMonthlyRetainer}
          autoAddInternalAdmins={autoAddInternalAdmins}
          onAutoAddInternalAdminsChange={setAutoAddInternalAdmins}
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

    if (stepIndex === 2) {
      return (
        <ContractTermsStep
          title={getAgreementTypeTitle(agreementType)}
          templateLabel={`Starting template: ${(selectedTerms?.version ?? selectedTermsVersion) || 'Missing template'}`}
          markdown={termsSourceMarkdown}
          onMarkdownChange={setTermsSourceMarkdown}
          previewMarkdown={renderedTermsPreview}
          onResetToDefault={() => {
            setSelectedTermsVersion(selectedTerms?.version ?? '');
            setTermsSourceMarkdown(selectedTerms?.body_markdown ?? '');
          }}
        />
      );
    }

    if (stepIndex === 3) {
      const summaryLines = [
        { label: 'Contact', value: inviteEmail || 'Missing email' },
        { label: 'Company', value: inviteCompanyName || 'No proposed company name' },
        { label: 'Agreement', value: getAgreementTypeLabel(agreementType) },
      ];

      if (isManagedServicesAgreement) {
        summaryLines.push(
          { label: 'Plan', value: currentPlanPreset.label },
          {
            label: 'Add-ons',
            value:
              [
                websiteTrafficSourcingEnabled ? 'Website traffic sourcing' : null,
                replyHandlingEnabled ? 'Reply handling' : null,
              ]
                .filter(Boolean)
                .join(', ') || 'None',
          },
          { label: 'Outreach volume', value: managedOutreachVolume || 'Missing' },
          { label: 'Inbox count', value: managedInboxCount || 'Missing' },
        );
      }

      return (
        <InviteReviewStep
          message={
            isManagedServicesAgreement
              ? 'Review the real invite flow below. This uses the same proposal, agreement, payment, and account setup screens prospects will see, but it does not publish the invite or start checkout.'
              : 'Review the real invite flow below. This uses the same agreement, payment, and account setup screens prospects will see, but it does not publish the invite or start checkout.'
          }
          summaryLines={summaryLines}
          reviewPreviewData={reviewPreviewData}
        >
          <PlatformInviteLogoEditor
            logoUrl={proposalClientLogoUrl}
            logoScale={proposalClientLogoScale}
            logoOffsetX={proposalClientLogoOffsetX}
            onLogoUrlChange={setProposalClientLogoUrl}
            onLogoScaleChange={setProposalClientLogoScale}
            onLogoOffsetChange={setProposalClientLogoOffsetX}
          />
        </InviteReviewStep>
      );
    }

    return (
      <InviteApprovalStep
        inviteEmail={inviteEmail}
        inviteCompanyName={inviteCompanyName}
        monthlyRetainerCents={monthlyRetainerCents}
        agreementType={agreementType}
        isManagedServicesAgreement={isManagedServicesAgreement}
        managedOutreachVolume={managedOutreachVolume}
        managedInboxCount={managedInboxCount}
        currentPlanLabel={currentPlanPreset.label}
        saving={saving}
        onBack={goBack}
        onSaveDraft={() => void handleSaveDraft()}
        onPublish={() => void handlePublishToClient()}
      />
    );
  };

  if (access === 'loading' || loading) {
    return (
      <PageLayout>
        <LoadingState message={isEditing ? 'Loading client package...' : 'Loading sign new client...'} />
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

  return (
    <WizardPageShell
      breadcrumbItems={[
        { label: 'Admin', href: '/admin' },
        { label: 'Account Management', href: '/admin/accounts' },
        { label: isEditing ? 'Edit Client Package' : 'Sign New Client' },
      ]}
      backHref={isEditing && params.invitationId ? `/admin/accounts/${params.invitationId}?kind=invitation` : '/admin/accounts'}
      title={isEditing ? 'Edit Client Package' : 'Sign New Client'}
      subtitle="Build the invite internally first, then publish to client when it is ready."
      steps={steps}
      activeStepIndex={stepIndex}
      onStepPress={goToStep}
      footer={
        stepIndex < steps.length - 1 ? (
          <WizardFooter>
            <Button
              variant="outline"
              fullWidth
              onPress={goBack}
              disabled={stepIndex === 0}
            >
              Back
            </Button>
            <Button fullWidth onPress={goNext}>
              Continue
            </Button>
          </WizardFooter>
        ) : undefined
      }
    >
      {renderStepBody()}
    </WizardPageShell>
  );
}
