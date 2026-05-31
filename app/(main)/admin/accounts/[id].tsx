import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  DETAIL_CONTENT_MAX_WIDTH,
  DetailPageShell,
  LAYOUT_BREAKPOINT,
  PageLayout,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Alert, LoadingState, useToast } from '@/components/ui/feedback';
import { ConfirmModal } from '@/components/ui/modals';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';
import { useAccount } from '@/contexts/AccountContext';
import {
  createBillingAdjustment,
  getPlatformAccountManagementDetail,
  markPlatformInvitationReady,
  publishPlatformInvitation,
  revokePlatformInvitation,
  type PlatformAccountManagementDetail,
  type PlatformInvitationRevisionSummary,
} from '@/lib/supabase/services/platform';
import { sendPlatformInvitationEmail } from '@/lib/services/platform';
import { PlatformProposalPreview } from '@/components/admin/account-management/PlatformProposalPreview';
import { PlatformInviteAdminEmbeddedPreview } from '@/components/platform-invite/PlatformInviteAdminEmbeddedPreview';
import { PlatformTermsMarkdown } from '@/components/platform-invite/PlatformTermsMarkdown';
import {
  AdminField,
  StatusBadge,
  formatUsd,
  normalizeProposalSnapshot,
} from '@/components/admin/account-management/shared';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import { getAgreementTypeLabel, normalizeAgreementType } from '@/lib/platform-invite/terms';

type InvitationDetailRecord = {
  id: string;
  email: string;
  status: string;
  expires_at: string | null;
  viewed_at: string | null;
  proposed_account_name: string | null;
  monthly_retainer_cents: number;
  currency: string;
  first_month_discount_cents: number;
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
  prepared_full_name: string | null;
  prepared_account_name: string | null;
  terms_accepted_at: string | null;
  payment_completed_at: string | null;
  created_account_id: string | null;
  invited_by_user_name: string | null;
  accepted_by_user_name: string | null;
  created_at: string;
  updated_at: string;
};

type AccountDetailRecord = {
  id: string;
  name: string;
  owner_user_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  created_at: string;
  updated_at: string;
};

type SourceInvitationRecord = {
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
  created_at: string;
  updated_at: string;
};

type TeamMemberRecord = {
  membership_id: string;
  user_id: string;
  name: string | null;
  email: string;
  role: string;
  is_owner: boolean;
  created_at: string;
};

function formatTimestamp(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getInviteUrl(invitationId: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://build.getfurnace.io';
  return `${origin}/accept-platform-invite/${invitationId}`;
}

function formatPaymentRouteLabel(route: 'card' | 'ach' | string | null) {
  if (route === 'ach') return 'ACH';
  if (route === 'card') return 'Card';
  return 'Not selected';
}

function RevisionCard({
  revision,
}: {
  revision: PlatformInvitationRevisionSummary;
}) {
  const flags = [
    revision.is_current ? 'Current' : null,
    revision.is_published ? 'Live' : null,
    revision.is_checkout ? 'Checkout' : null,
    revision.is_accepted ? 'Accepted' : null,
  ].filter(Boolean);

  return (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#181818] p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-white font-instrument-medium">Revision v{revision.revision_number}</Text>
          <Text className="text-gray-400 font-instrument text-xs mt-1">
            {revision.created_by_user_name} • {formatTimestamp(revision.created_at)}
          </Text>
        </View>
        {flags.length > 0 ? (
          <Text className="text-brand-orange font-instrument-medium text-xs">{flags.join(' • ')}</Text>
        ) : null}
      </View>
      <Text className="text-gray-300 font-instrument text-sm mt-3">
        {revision.proposed_account_name || revision.email} • {formatUsd(revision.monthly_retainer_cents)}
        {revision.first_month_discount_cents > 0
          ? ` • ${formatUsd(revision.first_month_discount_cents)} first-month discount`
          : ''}
      </Text>
    </View>
  );
}

export default function AccountManagementDetailPage() {
  const access = usePlatformAdminAccess();
  const { user: profile } = useAccount();
  const { toast } = useToast();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const contentWidthStyle = isMobile
    ? undefined
    : { maxWidth: DETAIL_CONTENT_MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const };
  const params = useLocalSearchParams<{ id: string; kind?: 'invitation' | 'account' }>();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PlatformAccountManagementDetail | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [adjustmentYear, setAdjustmentYear] = useState(String(new Date().getUTCFullYear()));
  const [adjustmentMonth, setAdjustmentMonth] = useState(String(new Date().getUTCMonth() + 1));
  const [adjustmentDiscount, setAdjustmentDiscount] = useState('0');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const loadDetail = async () => {
    if (!params.id || !params.kind) return;
    setLoading(true);
    try {
      setDetail(
        await getPlatformAccountManagementDetail({
          recordId: params.id,
          recordKind: params.kind,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load account detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (access === 'allowed' && params.id && params.kind) {
      void loadDetail();
    }
  }, [access, params.id, params.kind]);

  const invitation = (detail?.invitation ?? null) as InvitationDetailRecord | null;
  const sourceInvitation = (detail?.source_invitation ?? null) as SourceInvitationRecord | null;
  const account = (detail?.account ?? null) as AccountDetailRecord | null;
  const teamMembers = (detail?.team_members ?? []) as TeamMemberRecord[];
  const revisions = detail?.revisions ?? [];

  const currentRevision = useMemo(
    () => revisions.find((revision) => revision.is_current) ?? revisions[0] ?? null,
    [revisions],
  );
  const liveRevision = useMemo(
    () =>
      revisions.find(
        (revision) => revision.is_accepted || revision.is_checkout || revision.is_published,
      ) ?? null,
    [revisions],
  );

  const pageTitle =
    account?.name || invitation?.proposed_account_name || invitation?.email || 'Account detail';
  const pageSubtitle = account?.owner_email || invitation?.email || sourceInvitation?.email || undefined;

  const canEditInvitation =
    invitation != null &&
    !['active', 'pending_payment', 'revoked', 'expired'].includes(invitation.status);
  const canPublishInvitation = invitation != null && !['active', 'pending_payment', 'revoked', 'expired'].includes(invitation.status);
  const canRevokeInvitation = invitation != null && invitation.status !== 'active' && invitation.status !== 'revoked';

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
      if (invitation.status === 'draft') {
        await markPlatformInvitationReady(invitation.id);
      }
      await publishPlatformInvitation(invitation.id);
      const proposalTitle =
        normalizeAgreementType(currentRevision?.agreement_type ?? invitation.agreement_type) ===
        'managed_services_agreement'
          ? normalizeProposalSnapshot(currentRevision?.proposal_snapshot_json).proposal_title
          : 'Furnace Platform Access';
      await sendPlatformInvitationEmail({
        to: invitation.email,
        inviterName: profile?.name || profile?.email || 'Furnace',
        monthlyRetainerCents: invitation.monthly_retainer_cents,
        acceptUrl: getInviteUrl(invitation.id),
        proposalTitle,
        accountName: invitation.proposed_account_name ?? undefined,
      });
      toast.success(invitation.sent_at ? 'Latest revision sent.' : 'Invite approved and sent.');
      setSendOpen(false);
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setSavingAction(false);
    }
  };

  const handleMarkReady = async () => {
    if (!invitation) return;
    setSavingAction(true);
    try {
      await markPlatformInvitationReady(invitation.id);
      toast.success('Draft marked ready.');
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark draft ready.');
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

  if (access === 'loading' || loading) {
    return (
      <PageLayout>
        <LoadingState message="Loading account detail..." />
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

  if (!params.kind || !params.id) {
    return (
      <PageLayout>
        <Alert variant="error" message="Missing account detail route parameters." />
      </PageLayout>
    );
  }

  if (!detail) {
    return (
      <PageLayout>
        <Alert variant="error" message="No account detail data was returned." />
      </PageLayout>
    );
  }

  return (
    <>
      <DetailPageShell
        breadcrumbItems={[
          { label: 'Admin', href: '/admin' },
          { label: 'Account Management', href: '/admin/accounts' },
          { label: pageTitle },
        ]}
        backHref="/admin/accounts"
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={
          invitation ? (
            <View className="flex-row items-center gap-2">
              {canEditInvitation ? (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() =>
                    router.push({
                      pathname: '/admin/accounts/sign-new-client',
                      params: { invitationId: invitation.id },
                    })
                  }
                >
                  Edit
                </Button>
              ) : null}
              {canPublishInvitation ? (
                <Button size="sm" onPress={() => setSendOpen(true)}>
                  {invitation.sent_at ? 'Resend latest revision' : 'Approve and send'}
                </Button>
              ) : null}
            </View>
          ) : undefined
        }
      >
        <View style={contentWidthStyle} className="gap-6 w-full">
          <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
            <View className="flex-row flex-wrap items-center gap-3">
              {invitation ? <StatusBadge status={invitation.status} /> : null}
              {detail.billing?.billing_status ? (
                <StatusBadge
                  status={detail.billing.billing_status}
                  label={detail.billing.billing_status.replace(/_/g, ' ')}
                />
              ) : null}
            </View>

            {invitation ? (
              <View className="mt-4 gap-2">
                <Text className="text-gray-300 font-instrument">
                  Contact: {invitation.email}
                </Text>
                <Text className="text-gray-400 font-instrument text-sm">
                  Current revision: v{invitation.current_revision_number}
                  {invitation.published_revision_number
                    ? ` • live revision v${invitation.published_revision_number}`
                    : ' • not yet sent'}
                  {invitation.accepted_revision_number
                    ? ` • accepted revision v${invitation.accepted_revision_number}`
                    : ''}
                </Text>
                <Text className="text-gray-500 font-instrument text-sm">
                  Last email: {formatTimestamp(invitation.last_email_sent_at)}
                </Text>
                {invitation.selected_payment_route ? (
                  <Text className="text-gray-400 font-instrument text-sm">
                    Selected payment route: {formatPaymentRouteLabel(invitation.selected_payment_route)}
                    {invitation.selected_payment_total_cents != null
                      ? ` • total ${formatUsd(invitation.selected_payment_total_cents)}`
                      : ''}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View className="mt-4 gap-2">
                <Text className="text-gray-300 font-instrument">
                  Owner: {account?.owner_name || account?.owner_email || 'Unknown'}
                </Text>
                <Text className="text-gray-500 font-instrument text-sm">
                  Created {formatTimestamp(account?.created_at ?? null)}
                </Text>
              </View>
            )}

            {invitation ? (
              <View className="mt-5 flex-row flex-wrap gap-3">
                {canEditInvitation ? (
                  <Button
                    variant="outline"
                    onPress={() =>
                      router.push({
                        pathname: '/admin/accounts/sign-new-client',
                        params: { invitationId: invitation.id },
                      })
                    }
                  >
                    Edit Package
                  </Button>
                ) : null}
                {invitation.status === 'draft' ? (
                  <Button variant="secondary" onPress={handleMarkReady} disabled={savingAction}>
                    Mark Ready
                  </Button>
                ) : null}
                {invitation.published_revision_number ? (
                  <Button variant="outline" onPress={handleCopyInvite}>
                    Copy Invite Link
                  </Button>
                ) : null}
                {invitation.published_revision_number ? (
                  <Button
                    variant="outline"
                    onPress={() => {
                      if (typeof window !== 'undefined') {
                        window.open(getInviteUrl(invitation.id), '_blank');
                      }
                    }}
                  >
                    Open Invite
                  </Button>
                ) : null}
                {canPublishInvitation ? (
                  <Button onPress={() => setSendOpen(true)}>
                    {invitation.sent_at ? 'Resend latest revision' : 'Approve and send'}
                  </Button>
                ) : null}
                {canRevokeInvitation ? (
                  <Button variant="destructive" onPress={() => setRevokeOpen(true)}>
                    Revoke
                  </Button>
                ) : null}
              </View>
            ) : null}
          </View>

          {currentRevision && invitation ? (
            <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <PlatformInviteAdminEmbeddedPreview
                source="revision"
                invitationId={invitation.id}
                revisionNumber={currentRevision.revision_number}
                headerRight={
                  <View className="items-end">
                    <Text className="text-white font-instrument-semibold text-lg">
                      {formatUsd(currentRevision.monthly_retainer_cents)}
                      <Text className="text-gray-500 font-instrument text-sm">/mo</Text>
                    </Text>
                    {currentRevision.first_month_discount_cents > 0 ? (
                      <Text className="text-brand-orange font-instrument text-xs mt-0.5">
                        {formatUsd(currentRevision.first_month_discount_cents)} first-month discount
                      </Text>
                    ) : null}
                  </View>
                }
              />
            </View>
          ) : null}

          {liveRevision &&
          currentRevision &&
          liveRevision.id !== currentRevision.id &&
          normalizeAgreementType(liveRevision.agreement_type) === 'managed_services_agreement' ? (
            <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <View className="flex-row items-center justify-between mb-5 gap-4">
                <Text className="text-white text-xl font-instrument-semibold">Live client version</Text>
                <View className="items-end">
                  <Text className="text-white font-instrument-semibold text-lg">
                    {formatUsd(liveRevision.monthly_retainer_cents)}<Text className="text-gray-500 font-instrument text-sm">/mo</Text>
                  </Text>
                  {liveRevision.first_month_discount_cents > 0 ? (
                    <Text className="text-brand-orange font-instrument text-xs mt-0.5">
                      {formatUsd(liveRevision.first_month_discount_cents)} first-month discount
                    </Text>
                  ) : null}
                </View>
              </View>
              <PlatformProposalPreview
                proposalSnapshot={liveRevision.proposal_snapshot_json}
              />
            </View>
          ) : null}

          {invitation ? (
            <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <Text className="text-white text-xl font-instrument-semibold mb-3">Terms snapshot</Text>
              <Text className="text-gray-400 font-instrument text-sm mb-4">
                {getAgreementTypeLabel(
                  normalizeAgreementType(currentRevision?.agreement_type ?? invitation.agreement_type)
                )}
              </Text>
              <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
                <PlatformTermsMarkdown
                  markdown={currentRevision?.terms_snapshot_markdown ?? invitation.terms_snapshot_markdown}
                />
              </View>
            </View>
          ) : null}

          {invitation?.selected_payment_route ? (
            <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <Text className="text-white text-xl font-instrument-semibold mb-4">Payment route</Text>
              <View className="gap-2">
                <Text className="text-gray-300 font-instrument">
                  Route: {formatPaymentRouteLabel(invitation.selected_payment_route)}
                </Text>
                <Text className="text-gray-300 font-instrument">
                  Route fee: {formatUsd(invitation.selected_payment_route_fee_cents)}
                </Text>
                <Text className="text-gray-300 font-instrument">
                  Subtotal before fee: {formatUsd(invitation.selected_payment_subtotal_cents ?? 0)}
                </Text>
                <Text className="text-white font-instrument-semibold">
                  Total charged at initiation: {formatUsd(invitation.selected_payment_total_cents ?? 0)}
                </Text>
              </View>
            </View>
          ) : null}

          {revisions.length > 0 ? (
            <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <Text className="text-white text-xl font-instrument-semibold mb-5">Revision history</Text>
              <View className="gap-3">
                {revisions.map((revision) => (
                  <RevisionCard key={revision.id} revision={revision} />
                ))}
              </View>
            </View>
          ) : null}

          {account ? (
            <>
              {sourceInvitation ? (
                <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
                  <Text className="text-white text-xl font-instrument-semibold mb-4">
                    Originating invite
                  </Text>
                  <View className="gap-2">
                    <Text className="text-gray-300 font-instrument">
                      Contact: {sourceInvitation.email}
                    </Text>
                    <Text className="text-gray-300 font-instrument">
                      Status: {sourceInvitation.status}
                    </Text>
                    <Text className="text-gray-400 font-instrument text-sm">
                      Accepted revision: v{sourceInvitation.accepted_revision_number ?? '-'}
                    </Text>
                    {sourceInvitation.selected_payment_route ? (
                      <Text className="text-gray-400 font-instrument text-sm">
                        Payment route: {formatPaymentRouteLabel(sourceInvitation.selected_payment_route)}
                        {sourceInvitation.selected_payment_total_cents != null
                          ? ` • ${formatUsd(sourceInvitation.selected_payment_total_cents)} total`
                          : ''}
                      </Text>
                    ) : null}
                    <Text className="text-gray-500 font-instrument text-sm">
                      Created {formatTimestamp(sourceInvitation.created_at)}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
                <Text className="text-white text-xl font-instrument-semibold mb-4">Billing</Text>
                {detail.billing ? (
                  <View className="gap-2">
                    <Text className="text-gray-300 font-instrument">
                      Monthly retainer: {formatUsd(detail.billing.monthly_retainer_cents)}
                    </Text>
                    <Text className="text-gray-300 font-instrument">
                      Stripe customer: {detail.billing.stripe_customer_id || 'Not linked'}
                    </Text>
                    <Text className="text-gray-300 font-instrument">
                      Stripe subscription: {detail.billing.stripe_subscription_id || 'Not linked'}
                    </Text>
                  </View>
                ) : (
                  <Text className="text-gray-400 font-instrument">No billing row yet.</Text>
                )}

                <View className="mt-6 border-t border-[#2A2A2A] pt-6">
                  <Text className="text-white font-instrument-semibold text-lg mb-4">
                    Create billing adjustment
                  </Text>
                  <View className="flex-row gap-4">
                    <View className="flex-1">
                      <AdminField label="Billing year">
                        <TextInput
                          value={adjustmentYear}
                          onChangeText={setAdjustmentYear}
                          className={authInputClassName}
                          style={authInputStyle}
                          keyboardType="numeric"
                        />
                      </AdminField>
                    </View>
                    <View className="flex-1">
                      <AdminField label="Billing month">
                        <TextInput
                          value={adjustmentMonth}
                          onChangeText={setAdjustmentMonth}
                          className={authInputClassName}
                          style={authInputStyle}
                          keyboardType="numeric"
                        />
                      </AdminField>
                    </View>
                    <View className="flex-1">
                      <AdminField label="Discount (USD)">
                        <TextInput
                          value={adjustmentDiscount}
                          onChangeText={setAdjustmentDiscount}
                          className={authInputClassName}
                          style={authInputStyle}
                          keyboardType="numeric"
                        />
                      </AdminField>
                    </View>
                  </View>
                  <AdminField label="Reason">
                    <TextInput
                      value={adjustmentReason}
                      onChangeText={setAdjustmentReason}
                      placeholder="Why this adjustment exists"
                      placeholderTextColor={authPlaceholderColor}
                      className={authInputClassName}
                      style={authInputStyle}
                    />
                  </AdminField>
                  <Button onPress={handleCreateAdjustment} disabled={savingAction}>
                    Save billing adjustment
                  </Button>
                </View>

                <View className="mt-6 gap-3">
                  {detail.adjustments.length === 0 ? (
                    <Text className="text-gray-400 font-instrument">
                      No billing adjustments yet.
                    </Text>
                  ) : (
                    detail.adjustments.map((adjustment) => (
                      <View
                        key={adjustment.id}
                        className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4"
                      >
                        <Text className="text-white font-instrument-medium">
                          {adjustment.billing_year}-{String(adjustment.billing_month).padStart(2, '0')}
                        </Text>
                        <Text className="text-gray-300 font-instrument text-sm mt-1">
                          {formatUsd(adjustment.discount_cents)} discount • {adjustment.reason}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </View>

              <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
                <Text className="text-white text-xl font-instrument-semibold mb-4">Team members</Text>
                {teamMembers.length === 0 ? (
                  <Text className="text-gray-400 font-instrument">No team members found.</Text>
                ) : (
                  <View className="gap-3">
                    {teamMembers.map((member) => (
                      <View
                        key={member.membership_id}
                        className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4"
                      >
                        <View className="flex-row items-center justify-between gap-3">
                          <View className="flex-1">
                            <Text className="text-white font-instrument-medium">
                              {member.name || member.email}
                            </Text>
                            <Text className="text-gray-400 font-instrument text-sm mt-1">
                              {member.email}
                            </Text>
                          </View>
                          <StatusBadge
                            status={member.role}
                            label={member.is_owner ? 'owner' : member.role}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          ) : null}
        </View>
      </DetailPageShell>

      <ConfirmModal
        visible={sendOpen}
        onClose={() => setSendOpen(false)}
        onConfirm={() => void handleSendInvitation()}
        title={invitation?.sent_at ? 'Resend latest revision?' : 'Approve and send invite?'}
        message={
          invitation?.sent_at
            ? 'This publishes the latest approved revision and emails the client again.'
            : 'This publishes the current package and emails the client invite.'
        }
        confirmLabel={invitation?.sent_at ? 'Send revision' : 'Approve and send'}
      />

      <ConfirmModal
        visible={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onConfirm={() => void handleRevokeInvitation()}
        title="Revoke invitation?"
        message="The current client invite will stop working immediately."
        confirmLabel="Revoke invitation"
        confirmVariant="destructive"
      />
    </>
  );
}
