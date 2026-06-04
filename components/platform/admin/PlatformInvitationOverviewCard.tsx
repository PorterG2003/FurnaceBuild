import { Text, View, useWindowDimensions } from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import {
  ClientLinkPill,
  PlanBadge,
  StatusBadge,
  formatUsd,
  normalizeProposalSnapshot,
} from '@/components/platform/admin/shared';
import { AdminDetailFieldGrid } from '@/components/platform/admin/AdminCollapsibleCard';
import { getInvitationClientLinkPill } from '@/lib/platform/invite/invitationAdminState';
import { getAgreementTypeLabel, normalizeAgreementType, type AgreementType } from '@/lib/platform/contract/terms';
import type {
  PlatformAccountAmendment,
  PlatformInvitationRevisionSummary,
} from '@/lib/supabase/services/platform';

type InvitationOverview = {
  email: string;
  status: string;
  proposed_account_name: string | null;
  current_revision_number: number;
  published_revision_number: number | null;
};

type AccountOverview = {
  owner_name?: string | null;
  owner_email?: string | null;
  created_at: string;
};

type Props =
  | {
      variant: 'invitation';
      invitation: InvitationOverview;
      currentRevision: PlatformInvitationRevisionSummary | null;
    }
  | {
      variant: 'account';
      account: AccountOverview;
      billingStatus?: string | null;
      monthlyRetainerCents?: number | null;
      scheduledRetainerCents?: number | null;
      agreementType?: AgreementType | null;
      proposalSnapshotJson?: Record<string, unknown> | null;
      draftAmendment?: PlatformAccountAmendment | null;
      pendingAmendment?: PlatformAccountAmendment | null;
      formatTimestamp: (value: string | null) => string;
    };

const EM_DASH = '—';

export function PlatformInvitationOverviewCard(props: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  if (props.variant === 'account') {
    const {
      account,
      billingStatus,
      monthlyRetainerCents,
      scheduledRetainerCents,
      agreementType,
      proposalSnapshotJson,
      draftAmendment,
      pendingAmendment,
      formatTimestamp,
    } = props;
    const proposalSnapshot = proposalSnapshotJson
      ? normalizeProposalSnapshot(proposalSnapshotJson)
      : null;
    const normalizedAgreement = agreementType
      ? normalizeAgreementType(agreementType)
      : null;

    return (
      <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
        <Text className="text-white text-xl font-instrument-semibold mb-1">Current contract</Text>
        <Text className="text-gray-500 font-instrument text-sm mb-4">
          Active agreement and billing for this workspace.
        </Text>
        <View className="flex-row flex-wrap items-center gap-2 mb-4">
          {proposalSnapshot ? (
            <PlanBadge
              tier={proposalSnapshot.plan_tier}
              monthlyRetainerCents={monthlyRetainerCents ?? undefined}
            />
          ) : normalizedAgreement === 'platform_agreement' ? (
            <View className="self-start rounded-full border border-[#2A2A2A] bg-[#1F1F1F] px-2.5 py-1">
              <Text className="text-xs font-instrument-medium text-gray-300">Platform Access</Text>
            </View>
          ) : null}
          {billingStatus ? (
            <StatusBadge status={billingStatus} label={billingStatus.replace(/_/g, ' ')} />
          ) : null}
          {pendingAmendment ? (
            <ClientLinkPill
              label={
                pendingAmendment.status === 'pending_payment'
                  ? 'Pending owner payment'
                  : 'Pending owner acceptance'
              }
              tone="live"
            />
          ) : null}
          {draftAmendment ? (
            <ClientLinkPill label={`Draft v${draftAmendment.current_revision_number}`} tone="offline" />
          ) : null}
        </View>
        {monthlyRetainerCents != null ? (
          <Text className="text-gray-300 font-instrument text-sm mb-4">
            {formatUsd(monthlyRetainerCents)}/mo
            {scheduledRetainerCents != null
              ? ` → ${formatUsd(scheduledRetainerCents)}/mo scheduled`
              : ''}
          </Text>
        ) : null}
        {normalizedAgreement ? (
          <Text className="text-gray-400 font-instrument text-sm mb-4">
            {getAgreementTypeLabel(normalizedAgreement)}
          </Text>
        ) : null}
        <AdminDetailFieldGrid
          isMobile={isMobile}
          fields={[
            {
              key: 'owner',
              label: 'Owner',
              value: (
                <Text className="text-gray-300 font-instrument">
                  {account.owner_name || account.owner_email || 'Unknown'}
                </Text>
              ),
            },
            {
              key: 'email',
              label: 'Email',
              value: (
                <Text selectable className="text-gray-300 font-instrument">
                  {account.owner_email || EM_DASH}
                </Text>
              ),
            },
            {
              key: 'created',
              label: 'Created',
              value: (
                <Text className="text-gray-300 font-instrument">
                  {formatTimestamp(account.created_at)}
                </Text>
              ),
            },
          ]}
        />
      </View>
    );
  }

  const { invitation, currentRevision } = props;
  const clientLinkPill = getInvitationClientLinkPill(invitation);
  const proposalSnapshot = currentRevision
    ? normalizeProposalSnapshot(currentRevision.proposal_snapshot_json)
    : null;
  const companyTitle = invitation.proposed_account_name?.trim() || invitation.email || EM_DASH;

  return (
    <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
      <Text className="text-white text-xl font-instrument-semibold" numberOfLines={2}>
        {companyTitle}
      </Text>
      <Text
        selectable
        className="text-gray-500 font-instrument text-sm mt-1"
        numberOfLines={1}
      >
        {invitation.email}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2 mt-4">
        {proposalSnapshot ? (
          <PlanBadge
            tier={proposalSnapshot.plan_tier}
            monthlyRetainerCents={currentRevision?.monthly_retainer_cents}
          />
        ) : (
          <View className="self-start rounded-full border border-[#2A2A2A] bg-[#1F1F1F] px-2.5 py-1">
            <Text className="text-xs font-instrument-medium text-gray-300">{EM_DASH}</Text>
          </View>
        )}
        <StatusBadge status={invitation.status} />
        {clientLinkPill ? (
          <ClientLinkPill label={clientLinkPill.label} tone={clientLinkPill.tone} />
        ) : null}
      </View>
    </View>
  );
}
