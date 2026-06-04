import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { AdminCollapsibleCard } from '@/components/platform/admin/AdminCollapsibleCard';
import { PlatformInvitationOverviewCard } from '@/components/platform/admin/PlatformInvitationOverviewCard';
import { PlatformAccountDraftAmendmentBanner } from '@/components/platform/admin/PlatformAccountDraftAmendmentBanner';
import { PlatformAccountPendingAmendmentCard } from '@/components/platform/admin/PlatformAccountPendingAmendmentCard';
import { PlatformAccountAmendmentsSection } from '@/components/platform/admin/PlatformAccountAmendmentsSection';
import { PlatformTermsMarkdown } from '@/components/platform/contract/PlatformTermsMarkdown';
import { StatusBadge, formatUsd } from '@/components/platform/admin/shared';
import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import type { AgreementType } from '@/lib/platform/contract/terms';
import type { PlatformAccountAmendment, PlatformAccountManagementDetail } from '@/lib/supabase/services/platform';
import {
  formatPaymentRouteLabel,
  formatTimestamp,
  type AccountDetailRecord,
  type SourceInvitationRecord,
  type TeamMemberRecord,
} from '@/lib/platform/admin/useAccountManagementDetail';

export type PlatformAccountDetailViewProps = {
  detail: PlatformAccountManagementDetail;
  account: AccountDetailRecord;
  sourceInvitation: SourceInvitationRecord | null;
  teamMembers: TeamMemberRecord[];
  amendments: PlatformAccountAmendment[];
  pendingAmendment: PlatformAccountAmendment | null;
  pendingAmendmentInfo: { proposed_monthly_retainer_cents?: number | null } | null;
  draftAmendment: PlatformAccountAmendment | null;
  savingAction: boolean;
  isSectionExpanded: (key: string) => boolean;
  toggleSection: (key: string) => void;
  handleResendAmendmentEmail: () => Promise<void>;
  handleCopyAmendmentLink: () => Promise<void>;
  handleCancelAmendment: (amendmentId: string) => Promise<void>;
  handleCreateAdjustment: () => Promise<void>;
  adjustmentYear: string;
  setAdjustmentYear: (value: string) => void;
  adjustmentMonth: string;
  setAdjustmentMonth: (value: string) => void;
  adjustmentDiscount: string;
  setAdjustmentDiscount: (value: string) => void;
  adjustmentReason: string;
  setAdjustmentReason: (value: string) => void;
};

export function PlatformAccountDetailView({
  detail,
  account,
  sourceInvitation,
  teamMembers,
  amendments,
  pendingAmendment,
  pendingAmendmentInfo,
  draftAmendment,
  savingAction,
  isSectionExpanded,
  toggleSection,
  handleResendAmendmentEmail,
  handleCopyAmendmentLink,
  handleCancelAmendment,
  handleCreateAdjustment,
  adjustmentYear,
  setAdjustmentYear,
  adjustmentMonth,
  setAdjustmentMonth,
  adjustmentDiscount,
  setAdjustmentDiscount,
  adjustmentReason,
  setAdjustmentReason,
}: PlatformAccountDetailViewProps) {
  const router = useRouter();

  return (
    <>
      <PlatformInvitationOverviewCard
        variant="account"
        account={{
          owner_name: account.owner_name,
          owner_email: account.owner_email,
          created_at: account.created_at,
        }}
        billingStatus={detail.billing?.billing_status}
        monthlyRetainerCents={detail.billing?.monthly_retainer_cents}
        scheduledRetainerCents={
          (detail.billing as { scheduled_monthly_retainer_cents?: number | null } | null)
            ?.scheduled_monthly_retainer_cents ?? null
        }
        agreementType={
          (detail.billing as { agreement_type?: AgreementType | null } | null)?.agreement_type ??
          null
        }
        proposalSnapshotJson={
          (detail.billing as { proposal_snapshot_json?: Record<string, unknown> | null } | null)
            ?.proposal_snapshot_json ?? null
        }
        draftAmendment={draftAmendment}
        pendingAmendment={pendingAmendment}
        formatTimestamp={formatTimestamp}
      />

      <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 gap-3">
        <Text className="text-white font-instrument-semibold text-lg">Contract & billing changes</Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Send updated terms, change plan tier, or adjust monthly retainer. Changes that require
          owner acceptance are published from the amendment wizard.
        </Text>
        <View className="flex-row flex-wrap gap-2 items-center">
          <Button
            disabled={pendingAmendment != null}
            onPress={() =>
              router.push({
                pathname: '/admin/accounts/sign-account-amendment',
                params: { accountId: account.id },
              })
            }
          >
            Manage contract & billing
          </Button>
          {pendingAmendment ? (
            <Text className="text-amber-200/90 font-instrument text-sm flex-1 min-w-[200px]">
              {pendingAmendment.status === 'pending_payment'
                ? 'Waiting on owner payment — cancel or complete the pending amendment before starting another change.'
                : 'Waiting on owner acceptance — cancel or complete the pending amendment before starting another change.'}
            </Text>
          ) : null}
        </View>
      </View>

      {draftAmendment ? (
        <PlatformAccountDraftAmendmentBanner
          accountId={account.id}
          draftAmendment={draftAmendment}
          savingAction={savingAction}
          onCancel={() => void handleCancelAmendment(draftAmendment.id)}
        />
      ) : null}

      {pendingAmendment && detail.billing ? (
        <PlatformAccountPendingAmendmentCard
          pendingAmendment={pendingAmendment}
          currentRetainerCents={detail.billing.monthly_retainer_cents}
          proposedRetainerCents={pendingAmendmentInfo?.proposed_monthly_retainer_cents}
          savingAction={savingAction}
          onResendEmail={() => void handleResendAmendmentEmail()}
          onCopyLink={() => void handleCopyAmendmentLink()}
          formatTimestamp={formatTimestamp}
        />
      ) : null}

      <PlatformAccountAmendmentsSection
        accountId={account.id}
        amendments={amendments}
        expanded={isSectionExpanded('amendments')}
        onToggle={() => toggleSection('amendments')}
        savingAction={savingAction}
        onCancelAmendment={(amendmentId) => void handleCancelAmendment(amendmentId)}
        formatTimestamp={formatTimestamp}
      />

      {detail.billing?.terms_snapshot_markdown ? (
        <AdminCollapsibleCard
          title="Current contract terms"
          expanded={isSectionExpanded('contractTerms')}
          onToggle={() => toggleSection('contractTerms')}
        >
          <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
            <PlatformTermsMarkdown markdown={detail.billing.terms_snapshot_markdown} />
          </View>
        </AdminCollapsibleCard>
      ) : null}

      {sourceInvitation ? (
        <AdminCollapsibleCard
          title="Originating invite"
          expanded={isSectionExpanded('originatingInvite')}
          onToggle={() => toggleSection('originatingInvite')}
          summary={
            <Text className="text-gray-400 font-instrument text-sm text-right">
              {sourceInvitation.email}
            </Text>
          }
        >
          <View className="gap-2">
            <Text className="text-gray-300 font-instrument">Contact: {sourceInvitation.email}</Text>
            <Text className="text-gray-300 font-instrument">Status: {sourceInvitation.status}</Text>
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
            {sourceInvitation.first_recurring_invoice_target_cents != null ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Amount due on first recurring invoice:{' '}
                {formatUsd(sourceInvitation.first_recurring_invoice_target_cents)}
                {sourceInvitation.recurring_anchor_at
                  ? ` on ${formatTimestamp(sourceInvitation.recurring_anchor_at)}`
                  : ''}
              </Text>
            ) : null}
            {sourceInvitation.upfront_stripe_invoice_id ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Upfront Stripe invoice: {sourceInvitation.upfront_stripe_invoice_id}
              </Text>
            ) : null}
            <Text className="text-gray-500 font-instrument text-sm">
              Created {formatTimestamp(sourceInvitation.created_at)}
            </Text>
          </View>
        </AdminCollapsibleCard>
      ) : null}

      <AdminCollapsibleCard
        title="Billing"
        expanded={isSectionExpanded('billing')}
        onToggle={() => toggleSection('billing')}
        summary={
          <Text className="text-gray-400 font-instrument text-sm text-right">
            {detail.billing
              ? `${formatUsd(detail.billing.monthly_retainer_cents)}/mo`
              : 'No billing row'}
          </Text>
        }
      >
        {detail.billing ? (
          <View className="gap-2">
            <Text className="text-gray-300 font-instrument">
              Monthly retainer: {formatUsd(detail.billing.monthly_retainer_cents)}
            </Text>
            {(detail.billing as { scheduled_monthly_retainer_cents?: number | null })
              .scheduled_monthly_retainer_cents != null ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Scheduled:{' '}
                {formatUsd(
                  (detail.billing as { scheduled_monthly_retainer_cents: number })
                    .scheduled_monthly_retainer_cents,
                )}
                /mo
                {(detail.billing as { scheduled_retainer_effective_at?: string | null })
                  .scheduled_retainer_effective_at
                  ? ` on ${formatTimestamp((detail.billing as { scheduled_retainer_effective_at: string }).scheduled_retainer_effective_at)}`
                  : ''}
              </Text>
            ) : null}
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

        <Text className="text-gray-500 font-instrument text-xs mt-4">
          To change retainer, plan, or terms, use Manage contract & billing in the header.
        </Text>

        <View className="mt-6 border-t border-[#2A2A2A] pt-6">
          <Text className="text-white font-instrument-semibold text-lg mb-4">
            Create billing adjustment
          </Text>
          <View className="flex-row gap-4">
            <View className="flex-1">
              <FormFieldGroup label="Billing year">
                <TextInput
                  value={adjustmentYear}
                  onChangeText={setAdjustmentYear}
                  className={authInputClassName}
                  style={authInputStyle}
                  keyboardType="numeric"
                />
              </FormFieldGroup>
            </View>
            <View className="flex-1">
              <FormFieldGroup label="Billing month">
                <TextInput
                  value={adjustmentMonth}
                  onChangeText={setAdjustmentMonth}
                  className={authInputClassName}
                  style={authInputStyle}
                  keyboardType="numeric"
                />
              </FormFieldGroup>
            </View>
            <View className="flex-1">
              <FormFieldGroup label="Discount (USD)">
                <TextInput
                  value={adjustmentDiscount}
                  onChangeText={setAdjustmentDiscount}
                  className={authInputClassName}
                  style={authInputStyle}
                  keyboardType="numeric"
                />
              </FormFieldGroup>
            </View>
          </View>
          <FormFieldGroup label="Reason">
            <TextInput
              value={adjustmentReason}
              onChangeText={setAdjustmentReason}
              placeholder="Why this adjustment exists"
              placeholderTextColor={authPlaceholderColor}
              className={authInputClassName}
              style={authInputStyle}
            />
          </FormFieldGroup>
          <Button onPress={handleCreateAdjustment} disabled={savingAction}>
            Save billing adjustment
          </Button>
        </View>

        <View className="mt-6 gap-3">
          {detail.adjustments.length === 0 ? (
            <Text className="text-gray-400 font-instrument">No billing adjustments yet.</Text>
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
      </AdminCollapsibleCard>

      <AdminCollapsibleCard
        title="Team members"
        expanded={isSectionExpanded('teamMembers')}
        onToggle={() => toggleSection('teamMembers')}
        summary={
          <Text className="text-gray-400 font-instrument text-sm text-right">
            {teamMembers.length} member{teamMembers.length === 1 ? '' : 's'}
          </Text>
        }
      >
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
      </AdminCollapsibleCard>
    </>
  );
}
