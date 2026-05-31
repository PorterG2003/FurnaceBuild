import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  DETAIL_CONTENT_MAX_WIDTH,
  DetailPageShell,
  LAYOUT_BREAKPOINT,
  PageLayout,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/Toggle';
import { Alert, LoadingState, useToast } from '@/components/ui/feedback';
import { ModalStepIndicator } from '@/components/ui/modals';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';
import { useAccount } from '@/contexts/AccountContext';
import {
  AdminField,
  formatUsd,
  normalizeProposalSnapshot,
} from '@/components/admin/account-management/shared';
import { PlatformInviteAdminInlinePreview } from '@/components/platform-invite/PlatformInviteAdminInlinePreview';
import { PlatformInviteLogoEditor } from '@/components/platform-invite/PlatformInviteLogoEditor';
import { PlatformTermsMarkdown } from '@/components/platform-invite/PlatformTermsMarkdown';
import {
  getProposalPlanPreset,
  inferProposalPlanTier,
  isProposalPlanTier,
  PROPOSAL_PLAN_TIER_OPTIONS,
  type ProposalPlanTier,
} from '@/lib/platform-invite/proposalPlans';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import {
  createPlatformInvitationDraft,
  getPlatformAccountManagementDetail,
  listPlatformTermsVersions,
  markPlatformInvitationReady,
  publishPlatformInvitation,
  updatePlatformInvitationDraft,
  type PlatformTermsVersion,
} from '@/lib/supabase/services/platform';
import { sendPlatformInvitationEmail } from '@/lib/services/platform';
import {
  type PlatformInviteViewData,
} from '@/lib/platform-invite/types';
import {
  AGREEMENT_TYPE_OPTIONS,
  getAgreementTemplateMarkdown,
  getAgreementTypeLabel,
  getAgreementTypeTitle,
  getAgreementTypeVersion,
  normalizeAgreementType,
  renderPlatformTermsMarkdown,
  type AgreementType,
} from '@/lib/platform-invite/terms';
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
} from '@/lib/platform-invite/wizard';

const defaultPlanTier: ProposalPlanTier = 'silver';
const defaultPlanPreset = getProposalPlanPreset(defaultPlanTier);

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
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const contentWidthStyle = isMobile
    ? undefined
    : { maxWidth: DETAIL_CONTENT_MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const };
  const params = useLocalSearchParams<{ invitationId?: string }>();
  const isEditing = typeof params.invitationId === 'string' && params.invitationId.length > 0;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [termsVersions, setTermsVersions] = useState<PlatformTermsVersion[]>([]);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCompanyName, setInviteCompanyName] = useState('');
  const [inviteMonthlyRetainer, setInviteMonthlyRetainer] = useState(
    String(Math.round(defaultPlanPreset.paymentDefaultCents / 100)),
  );
  const [inviteFirstMonthDiscount, setInviteFirstMonthDiscount] = useState('0');
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
  const firstMonthDiscountCents = useMemo(
    () => parseInviteWizardUsdInputToCents(inviteFirstMonthDiscount) ?? 0,
    [inviteFirstMonthDiscount],
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
    () => ({
      proposal_title:
        agreementType === 'managed_services_agreement'
          ? getProposalPlanPreset(planTier).proposalTitle
          : 'Furnace Platform Access',
      client_logo_url: proposalClientLogoUrl.trim(),
      client_logo_scale: proposalClientLogoScale,
      client_logo_offset_x: proposalClientLogoOffsetX,
      plan_tier: planTier,
      website_traffic_sourcing_enabled: websiteTrafficSourcingEnabled,
      reply_handling_enabled: replyHandlingEnabled,
      managed_outreach_volume: managedOutreachVolumeValue,
      managed_inbox_count: managedInboxCountValue,
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
      renderPlatformTermsMarkdown({
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
      inviteFirstMonthDiscount,
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
      inviteFirstMonthDiscount,
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
  const { steps, goBack, goNext } = useInviteWizardController({
    agreementType,
    stepIndex,
    draft: {
      inviteEmail,
      inviteMonthlyRetainer,
      inviteFirstMonthDiscount,
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
    setInviteFirstMonthDiscount(draft.inviteFirstMonthDiscount);
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
    const preset = getProposalPlanPreset(nextTier);
    setPlanTier(nextTier);
    setInviteMonthlyRetainer(String(Math.round(preset.paymentDefaultCents / 100)));
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
          inviteMonthlyRetainer: String(Math.round(defaultPlanPreset.paymentDefaultCents / 100)),
          inviteFirstMonthDiscount: '0',
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
          const loadedPlanTier = isProposalPlanTier(rawProposal.plan_tier)
            ? rawProposal.plan_tier
            : inferProposalPlanTier(currentRevision?.monthly_retainer_cents);
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
                : String(Math.round(defaultPlanPreset.paymentDefaultCents / 100)),
            inviteFirstMonthDiscount:
              typeof invitation.first_month_discount_cents === 'number'
                ? String(Math.round(invitation.first_month_discount_cents / 100))
                : '0',
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
      monthlyRetainerCents <= 0 ||
      firstMonthDiscountCents < 0 ||
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
        firstMonthDiscountCents,
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
      firstMonthDiscountCents,
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

  const handleApproveAndSend = async () => {
    setSaving(true);
    try {
      const invitation = await saveDraft();
      await markPlatformInvitationReady(invitation.id);
      await publishPlatformInvitation(invitation.id);
      const proposalRecord =
        proposalSnapshot && typeof proposalSnapshot === 'object'
          ? (proposalSnapshot as Record<string, unknown>)
          : {};
      await sendPlatformInvitationEmail({
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
      showSuccessToast('Invite approved and sent.');
      router.replace({
        pathname: '/admin/accounts/[id]',
        params: { id: invitation.id, kind: 'invitation' },
      });
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to approve and send invite.');
    } finally {
      setSaving(false);
    }
  };

  const reviewPreviewData = useMemo<PlatformInviteViewData | null>(() => {
    if (!inviteEmail.trim() || monthlyRetainerCents == null || monthlyRetainerCents <= 0) {
      return null;
    }
    if (!termsSourceMarkdown.trim()) {
      return null;
    }

    return {
      invitationId: isEditing ? params.invitationId : undefined,
      status: 'draft',
      inviteeEmail: inviteEmail.trim().toLowerCase(),
      proposedAccountName: inviteCompanyName.trim() || null,
      monthlyRetainerCents,
      currency: 'usd',
      firstMonthDiscountCents,
      proposalSnapshot,
      agreementType,
      termsVersion: selectedTermsVersion,
      termsSourceMarkdown,
      termsSnapshotMarkdown: renderedTermsPreview,
      selectedPaymentRoute: 'card' as const,
    };
  }, [
    agreementType,
    inviteCompanyName,
    inviteEmail,
    inviteFirstMonthDiscount,
    inviteMonthlyRetainer,
    isEditing,
    params.invitationId,
    proposalSnapshot,
    selectedTermsVersion,
    termsSourceMarkdown,
    renderedTermsPreview,
  ]);

  const renderStepBody = () => {
    if (stepIndex === 0) {
      return (
        <View className="gap-2">
          <AdminField label="Invite email">
            <TextInput
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="client@company.com"
              placeholderTextColor={authPlaceholderColor}
              className={authInputClassName}
              style={authInputStyle}
              autoCapitalize="none"
            />
          </AdminField>
          <AdminField label="Proposed company or workspace name">
            <TextInput
              value={inviteCompanyName}
              onChangeText={setInviteCompanyName}
              placeholder="Sisu"
              placeholderTextColor={authPlaceholderColor}
              className={authInputClassName}
              style={authInputStyle}
            />
          </AdminField>
        </View>
      );
    }

    if (stepIndex === 1) {
      return (
        <View className="gap-2">
          <View className="flex-row gap-4">
            <View className="flex-1">
              <AdminField label="Monthly retainer (USD)">
                <TextInput
                  value={inviteMonthlyRetainer}
                  onChangeText={setInviteMonthlyRetainer}
                  placeholder="1800"
                  placeholderTextColor={authPlaceholderColor}
                  className={authInputClassName}
                  style={authInputStyle}
                  keyboardType="numeric"
                />
              </AdminField>
            </View>
            <View className="flex-1">
              <AdminField label="First month discount (USD)">
                <TextInput
                  value={inviteFirstMonthDiscount}
                  onChangeText={setInviteFirstMonthDiscount}
                  placeholder="0"
                  placeholderTextColor={authPlaceholderColor}
                  className={authInputClassName}
                  style={authInputStyle}
                  keyboardType="numeric"
                />
              </AdminField>
            </View>
          </View>
          <View className="mb-5 flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
            <Text className="flex-1 text-gray-300 font-instrument">
              Auto-add `porter@getfurnace.io` and `kyle@getfurnace.io` as admins
            </Text>
            <Toggle value={autoAddInternalAdmins} onValueChange={setAutoAddInternalAdmins} />
          </View>
        </View>
      );
    }

    if (stepIndex === 2) {
      return (
        <View className="gap-2">
          <AdminField label="Agreement type">
            <View className="flex-row gap-2">
              {AGREEMENT_TYPE_OPTIONS.map((option) => {
                const selected = option.type === agreementType;
                return (
                  <Pressable
                    key={option.type}
                    onPress={() => applyAgreementType(option.type)}
                    className={`rounded-lg border px-4 py-3 ${
                      selected
                        ? 'border-brand-orange bg-brand-orange/10'
                        : 'border-[#3A3A3A] bg-[#121212]'
                    }`}
                    style={{ flex: 1 }}
                  >
                    <Text
                      className={
                        selected
                          ? 'text-brand-orange font-instrument-semibold text-center'
                          : 'text-gray-300 font-instrument text-center'
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </AdminField>
          {isManagedServicesAgreement ? (
            <>
              <AdminField label="Plan tier">
                <View className="flex-row gap-2">
                  {PROPOSAL_PLAN_TIER_OPTIONS.map((option) => {
                    const selected = option.id === planTier;
                    return (
                      <Pressable
                        key={option.id}
                        onPress={() => applyPlanTier(option.id)}
                        className={`rounded-lg border px-4 py-3 ${
                          selected
                            ? 'border-brand-orange bg-brand-orange/10'
                            : 'border-[#3A3A3A] bg-[#121212]'
                        }`}
                        style={{ flex: 1 }}
                      >
                        <Text
                          className={
                            selected
                              ? 'text-brand-orange font-instrument-semibold text-center'
                              : 'text-gray-300 font-instrument text-center'
                          }
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </AdminField>
              <View className="gap-3 mb-4">
                <View className="flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
                  <View className="flex-1">
                    <Text className="text-white font-instrument-medium">Website traffic sourcing</Text>
                    <Text className="text-gray-400 font-instrument text-sm mt-1">
                      Show this proposal with website traffic sourcing enabled as an add-on.
                    </Text>
                  </View>
                  <Toggle
                    value={websiteTrafficSourcingEnabled}
                    onValueChange={setWebsiteTrafficSourcingEnabled}
                  />
                </View>
                <View className="flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
                  <View className="flex-1">
                    <Text className="text-white font-instrument-medium">Reply handling</Text>
                    <Text className="text-gray-400 font-instrument text-sm mt-1">
                      Show this proposal with reply handling enabled as an add-on.
                    </Text>
                  </View>
                  <Toggle value={replyHandlingEnabled} onValueChange={setReplyHandlingEnabled} />
                </View>
              </View>
            </>
          ) : (
            <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
              <Text className="text-white font-instrument-medium">Platform access invite</Text>
              <Text className="mt-1 text-sm font-instrument text-gray-400">
                This agreement path grants access to Furnace without a plan tier, add-ons, or
                managed-services proposal.
              </Text>
            </View>
          )}
          {isManagedServicesAgreement ? (
            <View className="flex-row gap-4">
              <View className="flex-1">
                <AdminField label="Outreach volume (emails/month)">
                  <TextInput
                    value={managedOutreachVolume}
                    onChangeText={setManagedOutreachVolume}
                    placeholder="5000"
                    placeholderTextColor={authPlaceholderColor}
                    className={authInputClassName}
                    style={authInputStyle}
                    keyboardType="numeric"
                  />
                </AdminField>
              </View>
              <View className="flex-1">
                <AdminField label="Sending inbox count">
                  <TextInput
                    value={managedInboxCount}
                    onChangeText={setManagedInboxCount}
                    placeholder="25"
                    placeholderTextColor={authPlaceholderColor}
                    className={authInputClassName}
                    style={authInputStyle}
                    keyboardType="numeric"
                  />
                </AdminField>
              </View>
            </View>
          ) : null}
        </View>
      );
    }

    if (stepIndex === 3) {
      return (
        <View className="gap-5">
          <AdminField label="Agreement template">
            <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
              <Text className="text-white font-instrument-medium">
                {getAgreementTypeTitle(agreementType)}
              </Text>
              <Text className="mt-1 text-sm font-instrument text-gray-400">
                Starting template: {(selectedTerms?.version ?? selectedTermsVersion) || 'Missing template'}
              </Text>
            </View>
          </AdminField>
          <AdminField label="Raw markdown">
            <TextInput
              value={termsSourceMarkdown}
              onChangeText={setTermsSourceMarkdown}
              placeholder="Paste or edit the full agreement markdown here"
              placeholderTextColor={authPlaceholderColor}
              className={authInputClassName}
              style={{ ...authInputStyle, minHeight: 240, textAlignVertical: 'top' }}
              multiline
            />
          </AdminField>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => {
                setSelectedTermsVersion(selectedTerms?.version ?? '');
                setTermsSourceMarkdown(selectedTerms?.body_markdown ?? '');
              }}
            >
              Reset to default template
            </Button>
          </View>
          <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-4">
            <Text className="mb-3 text-sm font-instrument-medium text-white">Rendered preview</Text>
            <PlatformTermsMarkdown markdown={renderedTermsPreview || 'Agreement preview will appear here.'} />
          </View>
        </View>
      );
    }

    if (stepIndex === 4) {
      return (
        <View className="gap-6">
          <Alert
            variant="info"
            message={
              isManagedServicesAgreement
                ? 'Review the real invite flow below. This uses the same proposal, agreement, payment, and account setup screens prospects will see, but it does not publish the invite or start checkout.'
                : 'Review the real invite flow below. This uses the same agreement, payment, and account setup screens prospects will see, but it does not publish the invite or start checkout.'
            }
          />
          <PlatformInviteLogoEditor
            logoUrl={proposalClientLogoUrl}
            logoScale={proposalClientLogoScale}
            logoOffsetX={proposalClientLogoOffsetX}
            onLogoUrlChange={setProposalClientLogoUrl}
            onLogoScaleChange={setProposalClientLogoScale}
            onLogoOffsetChange={setProposalClientLogoOffsetX}
          />
          <PlatformInviteAdminInlinePreview
            draftData={reviewPreviewData}
          />
          <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 gap-4">
            <View className="gap-2 border-t border-[#2A2A2A] pt-4">
              <Text className="text-gray-400 font-instrument text-sm">
                Contact: {inviteEmail || 'Missing email'}
              </Text>
              <Text className="text-gray-400 font-instrument text-sm">
                Company: {inviteCompanyName || 'No proposed company name'}
              </Text>
              <Text className="text-gray-400 font-instrument text-sm">
                Agreement: {getAgreementTypeLabel(agreementType)}
              </Text>
              {isManagedServicesAgreement ? (
                <>
                  <Text className="text-gray-400 font-instrument text-sm">
                    Plan: {currentPlanPreset.label}
                  </Text>
                  <Text className="text-gray-400 font-instrument text-sm">
                    Add-ons:{' '}
                    {[
                      websiteTrafficSourcingEnabled ? 'Website traffic sourcing' : null,
                      replyHandlingEnabled ? 'Reply handling' : null,
                    ]
                      .filter(Boolean)
                      .join(', ') || 'None'}
                  </Text>
                  <Text className="text-gray-400 font-instrument text-sm">
                    Outreach volume: {managedOutreachVolume || 'Missing'}
                  </Text>
                  <Text className="text-gray-400 font-instrument text-sm">
                    Inbox count: {managedInboxCount || 'Missing'}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        </View>
      );
    }

    return (
      <View className="gap-4">
        <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
          <Text className="text-white text-xl font-instrument-semibold mb-3">Approval checklist</Text>
          <Text className="text-gray-300 font-instrument">
            Email will not be sent until you explicitly approve and send. Saving a draft keeps this package internal.
          </Text>
          <View className="mt-4 gap-2">
            <Text className="text-gray-400 font-instrument">Client: {inviteEmail || 'Missing email'}</Text>
            <Text className="text-gray-400 font-instrument">
              Company: {inviteCompanyName || 'No proposed company name'}
            </Text>
            <Text className="text-gray-400 font-instrument">
              Retainer: {formatUsd(monthlyRetainerCents ?? 0)}
            </Text>
            <Text className="text-gray-400 font-instrument">
              Agreement: {getAgreementTypeLabel(agreementType)}
            </Text>
            {isManagedServicesAgreement ? (
              <>
                <Text className="text-gray-400 font-instrument">
                  Outreach volume: {managedOutreachVolume || 'Missing'}
                </Text>
                <Text className="text-gray-400 font-instrument">
                  Inbox count: {managedInboxCount || 'Missing'}
                </Text>
                <Text className="text-gray-400 font-instrument">
                  Plan: {currentPlanPreset.label}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        <View className="gap-3">
          <Button variant="outline" onPress={goBack} disabled={saving}>
            Back
          </Button>
          <Button variant="secondary" onPress={handleSaveDraft} disabled={saving}>
            {saving ? 'Saving draft...' : 'Save draft'}
          </Button>
          <Button onPress={handleApproveAndSend} disabled={saving}>
            {saving ? 'Sending invite...' : 'Approve and send'}
          </Button>
        </View>
      </View>
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
    <DetailPageShell
      breadcrumbItems={[
        { label: 'Admin', href: '/admin' },
        { label: 'Account Management', href: '/admin/accounts' },
        { label: isEditing ? 'Edit Client Package' : 'Sign New Client' },
      ]}
      backHref={isEditing && params.invitationId ? `/admin/accounts/${params.invitationId}?kind=invitation` : '/admin/accounts'}
      title={isEditing ? 'Edit Client Package' : 'Sign New Client'}
      subtitle="Build the invite internally first, then approve and send only when it is ready."
    >
      <View style={contentWidthStyle} className="gap-6 w-full">
        <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
          <ModalStepIndicator steps={steps} activeIndex={stepIndex} wrap />
        </View>

        <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
          {renderStepBody()}
        </View>

        {stepIndex < steps.length - 1 ? (
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onPress={goBack}
              disabled={stepIndex === 0}
            >
              Back
            </Button>
            <Button
              className="flex-1"
              onPress={goNext}
            >
              Continue
            </Button>
          </View>
        ) : null}
      </View>
    </DetailPageShell>
  );
}
