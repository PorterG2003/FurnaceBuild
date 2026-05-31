import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { Alert } from '@/components/ui/feedback';
import { PlatformInviteExperience } from '@/components/platform-invite/PlatformInviteExperience';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import {
  getPlatformAccountManagementDetail,
  type PlatformAccountManagementDetail,
} from '@/lib/supabase/services/platform';
import {
  buildPlatformInvitePreviewQuote,
  mapPlatformInvitationRevisionToPreviewData,
  readPlatformInvitePreviewDraft,
} from '@/lib/platform-invite/preview';
import type {
  PlatformInviteCheckoutInput,
  PlatformInviteViewData,
} from '@/lib/platform-invite/types';

type InvitationDetailRecord = {
  id: string;
  status: string;
};

export default function AdminInvitePreviewPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const { initialized, loading: accountLoading, platformAdminAccess } = useAccount();
  const params = useLocalSearchParams<{
    draftKey?: string;
    invitationId?: string;
    revisionNumber?: string;
    embedded?: string;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PlatformInviteViewData | null>(null);
  const isEmbedded = params.embedded === '1';
  const returnHref = useMemo(() => {
    if (typeof params.invitationId === 'string' && params.invitationId) {
      return {
        pathname: '/admin/accounts/[id]',
        params: { id: params.invitationId, kind: 'invitation' },
      } as const;
    }

    if (typeof params.draftKey === 'string' && params.draftKey) {
      return '/admin/accounts/sign-new-client';
    }

    return '/admin/accounts';
  }, [params.draftKey, params.invitationId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/auth');
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!isEmbedded || !user || !initialized || platformAdminAccess === 'loading') return;
    if (platformAdminAccess !== 'allowed') return;

    let cancelled = false;
    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      try {
        if (typeof params.draftKey === 'string' && params.draftKey) {
          const storedDraft = readPlatformInvitePreviewDraft(params.draftKey);
          if (!storedDraft) {
            throw new Error('Preview draft not found. Re-open the preview from the wizard.');
          }
          if (!cancelled) {
            setPreviewData(storedDraft);
          }
          return;
        }

        if (typeof params.invitationId === 'string' && params.invitationId) {
          const detail = (await getPlatformAccountManagementDetail({
            recordId: params.invitationId,
            recordKind: 'invitation',
          })) as PlatformAccountManagementDetail;
          const invitation = (detail.invitation ?? null) as InvitationDetailRecord | null;
          if (!invitation) {
            throw new Error('Invitation detail was not available for preview.');
          }

          const revisionNumber =
            typeof params.revisionNumber === 'string' && params.revisionNumber
              ? Number.parseInt(params.revisionNumber, 10)
              : null;
          const revision =
            (typeof revisionNumber === 'number' && Number.isFinite(revisionNumber)
              ? detail.revisions.find((item) => item.revision_number === revisionNumber)
              : null) ??
            detail.revisions.find((item) => item.is_current) ??
            detail.revisions[0] ??
            null;

          if (!revision) {
            throw new Error('No revision data was available for preview.');
          }

          if (!cancelled) {
            setPreviewData(mapPlatformInvitationRevisionToPreviewData(invitation, revision));
          }
          return;
        }

        throw new Error('Missing preview parameters.');
      } catch (err) {
        if (!cancelled) {
          setPreviewData(null);
          setError(err instanceof Error ? err.message : 'Failed to load preview.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [
    initialized,
    isEmbedded,
    params.draftKey,
    params.invitationId,
    params.revisionNumber,
    platformAdminAccess,
    user,
  ]);

  useEffect(() => {
    if (!user || !initialized || platformAdminAccess === 'loading') return;
    if (platformAdminAccess !== 'allowed') {
      setLoading(false);
      setError('You do not have access to admin previews.');
      return;
    }
    if (!isEmbedded) {
      router.replace(returnHref as never);
    }
  }, [initialized, isEmbedded, platformAdminAccess, returnHref, router, user]);

  const loadQuote = useCallback(
    async (paymentRoute: 'card' | 'ach') => {
      if (!previewData) {
        throw new Error('Preview data is not loaded yet.');
      }
      return buildPlatformInvitePreviewQuote(previewData, paymentRoute);
    },
    [previewData],
  );

  const handleCompleteCheckout = useCallback(
    async (_input: PlatformInviteCheckoutInput) => {
      return {
        kind: 'preview_complete',
        title: 'Checkout preview complete',
        message:
          'This is an internal preview path. No invite was published, no auth user was created, and no Stripe checkout session was started.',
      } as const;
    },
    [],
  );

  const showBoot = authLoading || !initialized || accountLoading || platformAdminAccess === 'loading';
  const showAccessError = !showBoot && platformAdminAccess !== 'allowed';

  if (showBoot) {
    return <AppBootScreen />;
  }

  if (showAccessError) {
    return <Alert variant="error" message="You do not have access to admin previews." />;
  }

  if (!isEmbedded) {
    return <AppBootScreen />;
  }

  return (
    <PlatformInviteExperience
      insets={insets}
      loading={loading}
      loadError={error}
      info={previewData}
      mode="preview"
      embedded
      onContinueExpired={() => router.replace(returnHref as never)}
      loadQuote={loadQuote}
      onCompleteCheckout={handleCompleteCheckout}
    />
  );
}
