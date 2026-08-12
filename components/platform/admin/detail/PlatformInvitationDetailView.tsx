import type { RefObject } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/modals';
import { AdminCollapsibleCard } from '@/components/platform/admin/AdminCollapsibleCard';
import { PlatformInvitationOverviewCard } from '@/components/platform/admin/PlatformInvitationOverviewCard';
import { PlatformInviteAdminEmbeddedPreview } from '@/components/platform/invite/PlatformInviteAdminEmbeddedPreview';
import { PlatformTermsMarkdown } from '@/components/platform/contract/PlatformTermsMarkdown';
import { formatUsd } from '@/components/platform/admin/shared';
import { Select } from '@/components/ui/forms/Select';
import { PREVIEW_VIEWPORT_OPTIONS } from '@/components/platform/invite/PlatformInvitePreviewFrame';
import type { PlatformInvitePreviewViewport } from '@/components/platform/invite/PlatformInvitePreviewFrame';
import {
  getInvitationPublishConfirmLabel,
  getInvitationPublishConfirmMessage,
  getInvitationPublishConfirmTitle,
  formatRevisionPreviewOption,
} from '@/lib/platform/invite/invitationAdminState';
import { getAgreementTypeLabel, normalizeAgreementType } from '@/lib/platform/contract/terms';
import {
  formatPaymentRouteLabel,
  formatTimestamp,
  type InvitationDetailRecord,
  type PlatformInvitationRevisionSummary,
} from '@/lib/platform/admin/useAccountManagementDetail';

function RevisionCard({
  revision,
  canRestore,
  onPreview,
  onRestore,
}: {
  revision: PlatformInvitationRevisionSummary;
  canRestore: boolean;
  onPreview: () => void;
  onRestore: () => void;
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
      </Text>
      <View className="flex-row flex-wrap justify-end gap-2 mt-4">
        <Button variant="outline" size="sm" onPress={onPreview}>
          Preview
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={onRestore}
          disabled={!canRestore || revision.is_current}
        >
          Restore
        </Button>
      </View>
    </View>
  );
}

function previewSummary(revision: PlatformInvitationRevisionSummary) {
  return (
    <View className="items-end">
      <Text className="text-white font-instrument-semibold text-lg">
        {formatUsd(revision.monthly_retainer_cents)}
        <Text className="text-gray-500 font-instrument text-sm">/mo</Text>
      </Text>
      <Text className="text-gray-400 font-instrument text-xs mt-0.5">
        v{revision.revision_number}
      </Text>
    </View>
  );
}

export type PlatformInvitationDetailViewProps = {
  invitation: InvitationDetailRecord;
  currentRevision: PlatformInvitationRevisionSummary | null;
  sortedRevisions: PlatformInvitationRevisionSummary[];
  revisions: PlatformInvitationRevisionSummary[];
  selectedPreviewRevision: PlatformInvitationRevisionSummary | null;
  selectedPreviewRevisionNumber: number | null;
  setSelectedPreviewRevisionNumber: (value: number | null) => void;
  previewViewport: PlatformInvitePreviewViewport;
  setPreviewViewport: (value: PlatformInvitePreviewViewport) => void;
  previewSectionRef: RefObject<View | null>;
  canEditInvitation: boolean;
  isSectionExpanded: (key: string) => boolean;
  toggleSection: (key: string) => void;
  focusPreviewRevision: (revisionNumber: number) => void;
  sendOpen: boolean;
  setSendOpen: (open: boolean) => void;
  unpublishOpen: boolean;
  setUnpublishOpen: (open: boolean) => void;
  restoreOpen: boolean;
  setRestoreOpen: (open: boolean) => void;
  restoreRevisionNumber: number | null;
  setRestoreRevisionNumber: (value: number | null) => void;
  revokeOpen: boolean;
  setRevokeOpen: (open: boolean) => void;
  handleSendInvitation: () => Promise<void>;
  handleUnpublishInvitation: () => Promise<void>;
  handleRestoreRevision: () => Promise<void>;
  handleRevokeInvitation: () => Promise<void>;
};

export function PlatformInvitationDetailView({
  invitation,
  currentRevision,
  sortedRevisions,
  revisions,
  selectedPreviewRevision,
  selectedPreviewRevisionNumber,
  setSelectedPreviewRevisionNumber,
  previewViewport,
  setPreviewViewport,
  previewSectionRef,
  canEditInvitation,
  isSectionExpanded,
  toggleSection,
  focusPreviewRevision,
  sendOpen,
  setSendOpen,
  unpublishOpen,
  setUnpublishOpen,
  restoreOpen,
  setRestoreOpen,
  restoreRevisionNumber,
  setRestoreRevisionNumber,
  revokeOpen,
  setRevokeOpen,
  handleSendInvitation,
  handleUnpublishInvitation,
  handleRestoreRevision,
  handleRevokeInvitation,
}: PlatformInvitationDetailViewProps) {
  return (
    <>
      <PlatformInvitationOverviewCard
        variant="invitation"
        invitation={invitation}
        currentRevision={currentRevision}
      />

      {currentRevision && invitation.status !== 'active' ? (
        <View ref={previewSectionRef} collapsable={false}>
          <AdminCollapsibleCard
            title="Preview invite"
            expanded={isSectionExpanded('preview')}
            onToggle={() => toggleSection('preview')}
            summary={selectedPreviewRevision ? previewSummary(selectedPreviewRevision) : undefined}
          >
            <View className="flex-row flex-wrap gap-4 mb-4">
              <View className="flex-1 min-w-[220px]">
                <Select
                  label="Version"
                  items={sortedRevisions}
                  searchable={false}
                  variant="solid"
                  size="compact"
                  panelSize="compact"
                  value={
                    selectedPreviewRevisionNumber != null
                      ? String(selectedPreviewRevisionNumber)
                      : null
                  }
                  getItemId={(revision) => String(revision.revision_number)}
                  getItemLabel={(revision) => ({
                    primary: formatRevisionPreviewOption(revision),
                  })}
                  onChange={(id) => setSelectedPreviewRevisionNumber(Number(id))}
                  placeholder="Select version"
                />
              </View>
              <View className="flex-1 min-w-[160px]">
                <Select
                  label="Viewport"
                  items={PREVIEW_VIEWPORT_OPTIONS}
                  searchable={false}
                  variant="solid"
                  size="compact"
                  panelSize="compact"
                  value={previewViewport}
                  getItemId={(option) => option.id}
                  getItemLabel={(option) => ({ primary: option.label })}
                  onChange={(id) => setPreviewViewport(id as PlatformInvitePreviewViewport)}
                  placeholder="Select viewport"
                />
              </View>
            </View>
            <PlatformInviteAdminEmbeddedPreview
              source="revision"
              invitationId={invitation.id}
              revisionNumber={selectedPreviewRevisionNumber ?? currentRevision.revision_number}
              showControls={false}
              showTitle={false}
              viewport={previewViewport}
              onViewportChange={setPreviewViewport}
              showViewportControls={false}
            />
          </AdminCollapsibleCard>
        </View>
      ) : null}

      <AdminCollapsibleCard
        title="Terms"
        expanded={isSectionExpanded('terms')}
        onToggle={() => toggleSection('terms')}
        summary={
          <Text className="text-gray-400 font-instrument text-sm text-right">
            {getAgreementTypeLabel(
              normalizeAgreementType(currentRevision?.agreement_type ?? invitation.agreement_type),
            )}
          </Text>
        }
      >
        <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
          <PlatformTermsMarkdown
            markdown={currentRevision?.terms_snapshot_markdown ?? invitation.terms_snapshot_markdown}
          />
        </View>
      </AdminCollapsibleCard>

      {invitation.selected_payment_route ? (
        <AdminCollapsibleCard
          title="Payment route"
          expanded={isSectionExpanded('paymentRoute')}
          onToggle={() => toggleSection('paymentRoute')}
          summary={
            <Text className="text-gray-400 font-instrument text-sm text-right">
              {formatPaymentRouteLabel(invitation.selected_payment_route)}
              {invitation.selected_payment_total_cents != null
                ? ` • ${formatUsd(invitation.selected_payment_total_cents)}`
                : ''}
            </Text>
          }
        >
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
            {invitation.first_recurring_invoice_target_cents != null ? (
              <Text className="text-gray-300 font-instrument">
                Amount due on first recurring invoice:{' '}
                {formatUsd(invitation.first_recurring_invoice_target_cents)}
                {invitation.recurring_anchor_at
                  ? ` on ${formatTimestamp(invitation.recurring_anchor_at)}`
                  : ''}
              </Text>
            ) : null}
            {invitation.upfront_stripe_invoice_id ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Upfront Stripe invoice: {invitation.upfront_stripe_invoice_id}
              </Text>
            ) : null}
            {invitation.first_recurring_coupon_id ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Stripe coupon for recurring overlap credit: {invitation.first_recurring_coupon_id}
              </Text>
            ) : null}
            {invitation.checkout_phase ? (
              <Text className="text-gray-300 font-instrument">
                Checkout phase: {invitation.checkout_phase}
              </Text>
            ) : null}
            {invitation.checkout_session_id ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Checkout session: {invitation.checkout_session_id}
              </Text>
            ) : null}
            {invitation.checkout_payment_intent_id ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Payment intent: {invitation.checkout_payment_intent_id}
              </Text>
            ) : null}
            {invitation.checkout_failure_summary ? (
              <Text className="text-red-300 font-instrument text-sm">
                Checkout error: {invitation.checkout_failure_summary}
              </Text>
            ) : null}
            {invitation.checkout_last_event_type ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Last Stripe event: {invitation.checkout_last_event_type}
                {invitation.checkout_last_reconciled_at
                  ? ` at ${formatTimestamp(invitation.checkout_last_reconciled_at)}`
                  : ''}
              </Text>
            ) : null}
            {invitation.checkout_provisioned_at ? (
              <Text className="text-gray-400 font-instrument text-sm">
                Provisioned at: {formatTimestamp(invitation.checkout_provisioned_at)}
              </Text>
            ) : null}
          </View>
        </AdminCollapsibleCard>
      ) : null}

      {revisions.length > 0 ? (
        <AdminCollapsibleCard
          title="Revision history"
          expanded={isSectionExpanded('revisionHistory')}
          onToggle={() => toggleSection('revisionHistory')}
          summary={
            <Text className="text-gray-400 font-instrument text-sm text-right">
              {revisions.length} revision{revisions.length === 1 ? '' : 's'}
            </Text>
          }
        >
          <View className="gap-3">
            {revisions.map((revision) => (
              <RevisionCard
                key={revision.id}
                revision={revision}
                canRestore={canEditInvitation}
                onPreview={() => focusPreviewRevision(revision.revision_number)}
                onRestore={() => {
                  setRestoreRevisionNumber(revision.revision_number);
                  setRestoreOpen(true);
                }}
              />
            ))}
          </View>
        </AdminCollapsibleCard>
      ) : null}

      <ConfirmModal
        visible={sendOpen}
        onClose={() => setSendOpen(false)}
        onConfirm={() => void handleSendInvitation()}
        title={getInvitationPublishConfirmTitle(invitation)}
        message={getInvitationPublishConfirmMessage(invitation)}
        confirmLabel={getInvitationPublishConfirmLabel(invitation)}
      />

      <ConfirmModal
        visible={unpublishOpen}
        onClose={() => setUnpublishOpen(false)}
        onConfirm={() => void handleUnpublishInvitation()}
        title="Unpublish invite?"
        message="Client link will stop working until you publish again."
        confirmLabel="Unpublish"
        confirmVariant="destructive"
      />

      <ConfirmModal
        visible={restoreOpen}
        onClose={() => {
          setRestoreOpen(false);
          setRestoreRevisionNumber(null);
        }}
        onConfirm={() => void handleRestoreRevision()}
        title={
          restoreRevisionNumber != null
            ? `Restore revision v${restoreRevisionNumber}?`
            : 'Restore revision?'
        }
        message="This copies the selected revision into a new draft revision. Publish to client when ready."
        confirmLabel="Restore"
      />

      <ConfirmModal
        visible={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onConfirm={() => void handleRevokeInvitation()}
        title="Revoke invitation?"
        message="This invite will stop working immediately and be removed from the default Account Management list. You can still find it using the Revoked lifecycle filter."
        confirmLabel="Revoke"
        confirmVariant="destructive"
      />
    </>
  );
}
