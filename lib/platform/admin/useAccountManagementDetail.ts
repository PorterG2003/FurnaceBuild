import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useToast } from '@/components/ui/feedback';
import { useAccount } from '@/contexts/AccountContext';
import {
  adminSetAccountManager,
  adminSetAccountOnboardingSegment,
  cancelPlatformAccountAmendment,
  createBillingAdjustment,
  getPlatformAccountAmendmentInfo,
  getPlatformAccountManagementDetail,
  listPlatformAccountAmendments,
  publishPlatformInvitation,
  restorePlatformInvitationRevision,
  revokePlatformInvitation,
  unpublishPlatformInvitation,
  type AccountManager,
  type OnboardingSegment,
  type PlatformAccountAmendment,
  type PlatformAccountAmendmentInfo,
  type PlatformAccountManagementDetail,
  type PlatformInvitationRevisionSummary,
} from '@/lib/supabase/services/platform';
import { sendPlatformAmendmentEmail, sendPlatformInviteEmail } from '@/lib/services/platform';
import { buildAmendmentAcceptUrl } from '@/lib/platform/amendment/acceptFlow';
import { isPendingAmendmentStatus } from '@/lib/platform/amendment/acceptFlow';
import {
  getDefaultPreviewRevisionNumber,
  getInvitationHasUnpublishedChanges,
  getInvitationPublishConfirmLabel,
} from '@/lib/platform/invite/invitationAdminState';
import type { PlatformInvitePreviewViewport } from '@/components/platform/invite/PlatformInvitePreviewFrame';
import { getPlatformInvitationPublishLabel } from '@/components/platform/admin/PlatformInvitationDetailActions';
import { normalizeProposalSnapshot } from '@/components/platform/admin/shared';
import { normalizeAgreementType } from '@/lib/platform/contract/terms';

export type InvitationDetailRecord = {
  id: string;
  email: string;
  status: string;
  expires_at: string | null;
  viewed_at: string | null;
  proposed_account_name: string | null;
  monthly_retainer_cents: number;
  currency: string;
  proposal_snapshot_json: Record<string, unknown>;
  agreement_type?: 'platform_agreement' | 'managed_services_agreement';
  terms_version: string;
  terms_source_markdown?: string;
  terms_snapshot_markdown: string;
  auto_add_internal_admins: boolean;
  current_revision_number: number;
  published_revision_number: number | null;
  checkout_revision_number: number | null;
  accepted_revision_number: number | null;
  approved_at: string | null;
  sent_at: string | null;
  last_email_sent_at: string | null;
  selected_payment_route: 'card' | 'ach' | null;
  selected_payment_route_fee_cents: number;
  selected_payment_subtotal_cents: number | null;
  selected_payment_total_cents: number | null;
  upfront_stripe_invoice_id?: string | null;
  upfront_stripe_payment_intent_id?: string | null;
  recurring_anchor_at?: string | null;
  first_recurring_invoice_target_cents?: number | null;
  first_recurring_coupon_id?: string | null;
  prepared_full_name: string | null;
  prepared_account_name: string | null;
  terms_accepted_at: string | null;
  payment_completed_at: string | null;
  created_account_id: string | null;
  invited_by_user_name: string | null;
  accepted_by_user_name: string | null;
  created_at: string;
  updated_at: string;
  current_checkout_attempt_id?: string | null;
  checkout_phase?: string | null;
  checkout_session_id?: string | null;
  checkout_payment_intent_id?: string | null;
  checkout_failure_summary?: string | null;
  checkout_last_event_type?: string | null;
  checkout_last_reconciled_at?: string | null;
  checkout_provisioned_at?: string | null;
};

export type AccountDetailRecord = {
  id: string;
  name: string;
  owner_user_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  onboarding_segment?: 'self_serve' | 'dfy' | null;
  account_manager?: 'porter' | 'kyle' | null;
  created_at: string;
  updated_at: string;
};

export type SourceInvitationRecord = {
  id: string;
  email: string;
  status: string;
  current_revision_number: number | null;
  published_revision_number: number | null;
  accepted_revision_number: number | null;
  selected_payment_route: 'card' | 'ach' | null;
  selected_payment_route_fee_cents: number;
  selected_payment_subtotal_cents: number | null;
  selected_payment_total_cents: number | null;
  upfront_stripe_invoice_id?: string | null;
  upfront_stripe_payment_intent_id?: string | null;
  recurring_anchor_at?: string | null;
  first_recurring_invoice_target_cents?: number | null;
  first_recurring_coupon_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamMemberRecord = {
  membership_id: string;
  user_id: string;
  name: string | null;
  email: string;
  role: string;
  is_owner: boolean;
  created_at: string;
};

export function formatTimestamp(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function getInviteUrl(invitationId: string) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://build.getfurnace.io';
  return `${origin}/accept-platform-invite/${invitationId}`;
}

export function formatPaymentRouteLabel(route: 'card' | 'ach' | string | null) {
  if (route === 'ach') return 'ACH';
  if (route === 'card') return 'Card';
  return 'Not selected';
}

type UseAccountManagementDetailParams = {
  recordId: string | undefined;
  recordKind: 'invitation' | 'account' | undefined;
  enabled: boolean;
};

export function useAccountManagementDetail({
  recordId,
  recordKind,
  enabled,
}: UseAccountManagementDetailParams) {
  const { user: profile } = useAccount();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PlatformAccountManagementDetail | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreRevisionNumber, setRestoreRevisionNumber] = useState<number | null>(null);
  const [selectedPreviewRevisionNumber, setSelectedPreviewRevisionNumber] = useState<number | null>(
    null,
  );
  const [previewViewport, setPreviewViewport] = useState<PlatformInvitePreviewViewport>('mobile');
  const previewSectionRef = useRef<View>(null);
  const [savingAction, setSavingAction] = useState(false);
  const [adjustmentYear, setAdjustmentYear] = useState(String(new Date().getUTCFullYear()));
  const [adjustmentMonth, setAdjustmentMonth] = useState(String(new Date().getUTCMonth() + 1));
  const [adjustmentDiscount, setAdjustmentDiscount] = useState('0');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [amendments, setAmendments] = useState<PlatformAccountAmendment[]>([]);
  const [pendingAmendmentInfo, setPendingAmendmentInfo] =
    useState<PlatformAccountAmendmentInfo | null>(null);
  const [sectionExpanded, setSectionExpanded] = useState<Record<string, boolean>>({});

  const isSectionExpanded = (key: string) => sectionExpanded[key] ?? false;
  const toggleSection = (key: string) =>
    setSectionExpanded((current) => ({ ...current, [key]: !(current[key] ?? false) }));

  const loadDetail = async () => {
    if (!recordId || !recordKind) return;
    setLoading(true);
    try {
      const nextDetail = await getPlatformAccountManagementDetail({
        recordId,
        recordKind,
      });
      setDetail(nextDetail);
      if (recordKind === 'account') {
        const nextAmendments = await listPlatformAccountAmendments(recordId);
        setAmendments(nextAmendments);
        const pending = nextAmendments.find((item) => isPendingAmendmentStatus(item.status)) ?? null;
        if (pending) {
          const info = await getPlatformAccountAmendmentInfo(pending.id);
          setPendingAmendmentInfo(isPendingAmendmentStatus(info.status) ? info : null);
        } else {
          setPendingAmendmentInfo(null);
        }
      } else {
        setAmendments([]);
        setPendingAmendmentInfo(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load account detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (enabled && recordId && recordKind) {
      void loadDetail();
    }
  }, [enabled, recordId, recordKind]);

  const invitation = (detail?.invitation ?? null) as InvitationDetailRecord | null;

  useEffect(() => {
    if (recordKind !== 'invitation' || !invitation) return;
    if (invitation.status === 'active' && invitation.created_account_id) {
      router.replace({
        pathname: '/admin/accounts/[id]',
        params: { id: invitation.created_account_id, kind: 'account' },
      });
    }
  }, [invitation, recordKind, router]);

  const sourceInvitation = (detail?.source_invitation ?? null) as SourceInvitationRecord | null;
  const account = (detail?.account ?? null) as AccountDetailRecord | null;
  const teamMembers = (detail?.team_members ?? []) as TeamMemberRecord[];
  const revisions = detail?.revisions ?? [];

  const currentRevision = useMemo(
    () => revisions.find((revision) => revision.is_current) ?? revisions[0] ?? null,
    [revisions],
  );
  const sortedRevisions = useMemo(
    () => [...revisions].sort((left, right) => right.revision_number - left.revision_number),
    [revisions],
  );
  const selectedPreviewRevision = useMemo(() => {
    if (selectedPreviewRevisionNumber == null) return currentRevision;
    return (
      revisions.find((revision) => revision.revision_number === selectedPreviewRevisionNumber) ??
      currentRevision
    );
  }, [currentRevision, revisions, selectedPreviewRevisionNumber]);

  useEffect(() => {
    if (invitation) {
      setSelectedPreviewRevisionNumber(getDefaultPreviewRevisionNumber(invitation));
    }
  }, [invitation?.id, invitation?.current_revision_number, invitation?.published_revision_number]);

  const focusPreviewRevision = useCallback((revisionNumber: number) => {
    setSelectedPreviewRevisionNumber(revisionNumber);
    setSectionExpanded((current) => ({ ...current, preview: true }));
    requestAnimationFrame(() => {
      const node = previewSectionRef.current as unknown as {
        scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
      } | null;
      node?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const canUnpublishInvitation =
    invitation != null &&
    invitation.published_revision_number != null &&
    !['pending_payment', 'active', 'revoked', 'expired'].includes(invitation.status);

  const pageTitle =
    account?.name || invitation?.proposed_account_name || invitation?.email || 'Account detail';
  const pageSubtitle = account?.owner_email || invitation?.email || sourceInvitation?.email || undefined;

  const canEditInvitation =
    invitation != null &&
    !['active', 'pending_payment', 'revoked', 'expired'].includes(invitation.status);
  const canPublishInvitation =
    invitation != null &&
    !['active', 'pending_payment', 'revoked', 'expired'].includes(invitation.status);
  const canRevokeInvitation =
    invitation != null && invitation.status !== 'active' && invitation.status !== 'revoked';

  const handleCopyInvite = async () => {
    if (!invitation) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(getInviteUrl(invitation.id));
      toast.success('Invite link copied.');
    } else {
      toast.info('Clipboard is only available on web.');
    }
  };

  const handleSendInvitation = async () => {
    if (!invitation) return;
    setSavingAction(true);
    try {
      await publishPlatformInvitation(invitation.id);
      const emailRevision = currentRevision;
      const proposalTitle =
        normalizeAgreementType(emailRevision?.agreement_type ?? invitation.agreement_type) ===
        'managed_services_agreement'
          ? normalizeProposalSnapshot(emailRevision?.proposal_snapshot_json).proposal_title
          : 'Furnace Platform Access';
      await sendPlatformInviteEmail({
        to: invitation.email,
        inviterName: profile?.name || profile?.email || 'Furnace',
        monthlyRetainerCents: emailRevision?.monthly_retainer_cents ?? invitation.monthly_retainer_cents,
        acceptUrl: getInviteUrl(invitation.id),
        proposalTitle,
        accountName: invitation.proposed_account_name ?? undefined,
      });
      const publishLabel = getInvitationPublishConfirmLabel(invitation);
      toast.success(
        publishLabel === 'Send'
          ? 'Invite email sent.'
          : getInvitationHasUnpublishedChanges(invitation)
            ? 'Changes published to client.'
            : 'Invite published to client.',
      );
      setSendOpen(false);
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish invite.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleUnpublishInvitation = async () => {
    if (!invitation) return;
    setSavingAction(true);
    try {
      await unpublishPlatformInvitation(invitation.id);
      toast.success('Invite unpublished. Client link is offline until you publish again.');
      setUnpublishOpen(false);
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unpublish invite.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleRestoreRevision = async () => {
    if (!invitation || restoreRevisionNumber == null) return;
    setSavingAction(true);
    try {
      const restored = await restorePlatformInvitationRevision(invitation.id, restoreRevisionNumber);
      toast.success(
        `Restored as v${restored.current_revision_number}. Publish to client when ready.`,
      );
      setRestoreOpen(false);
      setRestoreRevisionNumber(null);
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore revision.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleRevokeInvitation = async () => {
    if (!invitation) return;
    setSavingAction(true);
    try {
      await revokePlatformInvitation(invitation.id);
      toast.success('Invitation revoked.');
      setRevokeOpen(false);
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke invitation.');
    } finally {
      setSavingAction(false);
    }
  };

  const invitationActionProps =
    invitation != null
      ? {
          invitation,
          canEditInvitation,
          canPublishInvitation,
          canUnpublishInvitation,
          canRevokeInvitation,
          savingAction,
          publishLabel: getPlatformInvitationPublishLabel(invitation),
          onCopyInvite: () => void handleCopyInvite(),
          onOpenInvite: () => {
            if (typeof window !== 'undefined') {
              window.open(getInviteUrl(invitation.id), '_blank');
            }
          },
          onPublish: () => setSendOpen(true),
          onUnpublish: () => setUnpublishOpen(true),
          onRevoke: () => setRevokeOpen(true),
        }
      : null;

  const pendingAmendment = amendments.find((item) => isPendingAmendmentStatus(item.status)) ?? null;
  const draftAmendment = amendments.find((item) => item.status === 'draft') ?? null;
  const ownerMember = teamMembers.find((member) => member.is_owner);
  const ownerEmail = ownerMember?.email ?? null;
  const inviterName = profile?.name || profile?.email || 'Furnace';

  const handleResendAmendmentEmail = async () => {
    if (!pendingAmendment || !ownerEmail) {
      toast.error('Owner email is required to resend.');
      return;
    }
    setSavingAction(true);
    try {
      await sendPlatformAmendmentEmail({
        to: ownerEmail,
        inviterName,
        acceptUrl: buildAmendmentAcceptUrl(pendingAmendment.id),
        accountName: account?.name ?? undefined,
      });
      toast.success('Acceptance email sent.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send email.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleCopyAmendmentLink = async () => {
    if (!pendingAmendment) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(buildAmendmentAcceptUrl(pendingAmendment.id));
      toast.success('Accept link copied.');
    } else {
      toast.info('Clipboard is only available on web.');
    }
  };

  const handleCancelAmendment = async (amendmentId: string) => {
    setSavingAction(true);
    try {
      await cancelPlatformAccountAmendment(amendmentId);
      toast.success('Amendment canceled.');
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel amendment.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleSetOnboardingSegment = async (segment: OnboardingSegment | null) => {
    if (!account?.id) return;
    setSavingAction(true);
    try {
      await adminSetAccountOnboardingSegment(account.id, segment);
      toast.success(
        segment === null
          ? 'Onboarding segment reset to automatic.'
          : `Onboarding segment set to ${segment === 'dfy' ? 'done-for-you' : 'self-serve'}.`,
      );
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update onboarding segment.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleSetAccountManager = async (manager: AccountManager) => {
    if (!account?.id) return;
    setSavingAction(true);
    try {
      await adminSetAccountManager(account.id, manager);
      toast.success(
        `Account manager set to ${manager === 'kyle' ? 'Kyle' : 'Porter'}.`,
      );
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update account manager.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleCreateAdjustment = async () => {
    if (!account?.id) return;
    const discountCents = Math.round(Number(adjustmentDiscount || 0) * 100);
    if (!adjustmentReason.trim()) {
      toast.error('Reason is required.');
      return;
    }
    setSavingAction(true);
    try {
      await createBillingAdjustment({
        accountId: account.id,
        billingYear: Number(adjustmentYear),
        billingMonth: Number(adjustmentMonth),
        discountCents,
        reason: adjustmentReason.trim(),
      });
      toast.success('Billing adjustment saved.');
      setAdjustmentDiscount('0');
      setAdjustmentReason('');
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save billing adjustment.');
    } finally {
      setSavingAction(false);
    }
  };

  return {
    loading,
    detail,
    pageTitle,
    pageSubtitle,
    invitation,
    account,
    sourceInvitation,
    teamMembers,
    revisions,
    currentRevision,
    sortedRevisions,
    selectedPreviewRevision,
    selectedPreviewRevisionNumber,
    setSelectedPreviewRevisionNumber,
    previewViewport,
    setPreviewViewport,
    previewSectionRef,
    savingAction,
    amendments,
    pendingAmendment,
    pendingAmendmentInfo,
    draftAmendment,
    ownerEmail,
    inviterName,
    canEditInvitation,
    invitationActionProps,
    revokeOpen,
    setRevokeOpen,
    sendOpen,
    setSendOpen,
    unpublishOpen,
    setUnpublishOpen,
    restoreOpen,
    setRestoreOpen,
    restoreRevisionNumber,
    setRestoreRevisionNumber,
    isSectionExpanded,
    toggleSection,
    focusPreviewRevision,
    handleSendInvitation,
    handleUnpublishInvitation,
    handleRestoreRevision,
    handleRevokeInvitation,
    handleResendAmendmentEmail,
    handleCopyAmendmentLink,
    handleCancelAmendment,
    handleCreateAdjustment,
    handleSetOnboardingSegment,
    handleSetAccountManager,
    adjustmentYear,
    setAdjustmentYear,
    adjustmentMonth,
    setAdjustmentMonth,
    adjustmentDiscount,
    setAdjustmentDiscount,
    adjustmentReason,
    setAdjustmentReason,
  };
}

export type { PlatformInvitationRevisionSummary };
