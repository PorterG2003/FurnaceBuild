import { View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  DETAIL_CONTENT_MAX_WIDTH,
  DetailPageShell,
  LAYOUT_BREAKPOINT,
  PageLayout,
} from '@/components/ui/layout';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';
import {
  PlatformAccountDetailDesktopActions,
  PlatformAccountDetailMobileActions,
} from '@/components/platform/admin/PlatformAccountDetailActions';
import {
  PlatformInvitationDetailDesktopActions,
  PlatformInvitationDetailMobileActions,
} from '@/components/platform/admin/PlatformInvitationDetailActions';
import { PlatformInvitationDetailView } from '@/components/platform/admin/detail/PlatformInvitationDetailView';
import { PlatformAccountDetailView } from '@/components/platform/admin/detail/PlatformAccountDetailView';
import { useAccountManagementDetail } from '@/lib/platform/admin/useAccountManagementDetail';

export default function AccountManagementDetailPage() {
  const access = usePlatformAdminAccess();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const contentWidthStyle = isMobile
    ? undefined
    : { maxWidth: DETAIL_CONTENT_MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const };
  const params = useLocalSearchParams<{ id: string; kind?: 'invitation' | 'account' }>();

  const detailState = useAccountManagementDetail({
    recordId: params.id,
    recordKind: params.kind,
    enabled: access === 'allowed',
  });

  if (access === 'loading' || detailState.loading) {
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

  if (!detailState.detail) {
    return (
      <PageLayout>
        <Alert variant="error" message="No account detail data was returned." />
      </PageLayout>
    );
  }

  const { invitationActionProps, account, invitation, pendingAmendment, ownerEmail, inviterName } =
    detailState;

  const accountHeaderActions = account
    ? {
        accountId: account.id,
        pendingAmendment,
        ownerEmail,
        accountName: account.name,
        inviterName,
        savingAction: detailState.savingAction,
        onResendEmail: () => void detailState.handleResendAmendmentEmail(),
      }
    : null;

  return (
    <DetailPageShell
      breadcrumbItems={[
        { label: 'Admin', href: '/admin' },
        { label: 'Account Management', href: '/admin/accounts' },
        { label: detailState.pageTitle },
      ]}
      backHref="/admin/accounts"
      title={detailState.pageTitle}
      subtitle={detailState.pageSubtitle}
      actions={
        invitationActionProps && !isMobile ? (
          <PlatformInvitationDetailDesktopActions {...invitationActionProps} />
        ) : accountHeaderActions && !isMobile ? (
          <PlatformAccountDetailDesktopActions {...accountHeaderActions} />
        ) : undefined
      }
      mobileRightAction={
        invitationActionProps && isMobile ? (
          <PlatformInvitationDetailMobileActions {...invitationActionProps} />
        ) : accountHeaderActions && isMobile ? (
          <PlatformAccountDetailMobileActions {...accountHeaderActions} />
        ) : undefined
      }
    >
      <View style={contentWidthStyle} className="gap-6 w-full">
        {invitation ? (
          <PlatformInvitationDetailView
            invitation={invitation}
            currentRevision={detailState.currentRevision}
            sortedRevisions={detailState.sortedRevisions}
            revisions={detailState.revisions}
            selectedPreviewRevision={detailState.selectedPreviewRevision}
            selectedPreviewRevisionNumber={detailState.selectedPreviewRevisionNumber}
            setSelectedPreviewRevisionNumber={detailState.setSelectedPreviewRevisionNumber}
            previewViewport={detailState.previewViewport}
            setPreviewViewport={detailState.setPreviewViewport}
            previewSectionRef={detailState.previewSectionRef}
            canEditInvitation={detailState.canEditInvitation}
            isSectionExpanded={detailState.isSectionExpanded}
            toggleSection={detailState.toggleSection}
            focusPreviewRevision={detailState.focusPreviewRevision}
            sendOpen={detailState.sendOpen}
            setSendOpen={detailState.setSendOpen}
            unpublishOpen={detailState.unpublishOpen}
            setUnpublishOpen={detailState.setUnpublishOpen}
            restoreOpen={detailState.restoreOpen}
            setRestoreOpen={detailState.setRestoreOpen}
            restoreRevisionNumber={detailState.restoreRevisionNumber}
            setRestoreRevisionNumber={detailState.setRestoreRevisionNumber}
            revokeOpen={detailState.revokeOpen}
            setRevokeOpen={detailState.setRevokeOpen}
            handleSendInvitation={detailState.handleSendInvitation}
            handleUnpublishInvitation={detailState.handleUnpublishInvitation}
            handleRestoreRevision={detailState.handleRestoreRevision}
            handleRevokeInvitation={detailState.handleRevokeInvitation}
          />
        ) : account ? (
          <PlatformAccountDetailView
            detail={detailState.detail}
            account={account}
            sourceInvitation={detailState.sourceInvitation}
            teamMembers={detailState.teamMembers}
            amendments={detailState.amendments}
            pendingAmendment={detailState.pendingAmendment}
            pendingAmendmentInfo={detailState.pendingAmendmentInfo}
            draftAmendment={detailState.draftAmendment}
            savingAction={detailState.savingAction}
            isSectionExpanded={detailState.isSectionExpanded}
            toggleSection={detailState.toggleSection}
            handleResendAmendmentEmail={detailState.handleResendAmendmentEmail}
            handleCopyAmendmentLink={detailState.handleCopyAmendmentLink}
            handleCancelAmendment={detailState.handleCancelAmendment}
            handleCreateAdjustment={detailState.handleCreateAdjustment}
            handleSetOnboardingSegment={detailState.handleSetOnboardingSegment}
            adjustmentYear={detailState.adjustmentYear}
            setAdjustmentYear={detailState.setAdjustmentYear}
            adjustmentMonth={detailState.adjustmentMonth}
            setAdjustmentMonth={detailState.setAdjustmentMonth}
            adjustmentDiscount={detailState.adjustmentDiscount}
            setAdjustmentDiscount={detailState.setAdjustmentDiscount}
            adjustmentReason={detailState.adjustmentReason}
            setAdjustmentReason={detailState.setAdjustmentReason}
          />
        ) : null}
      </View>
    </DetailPageShell>
  );
}
