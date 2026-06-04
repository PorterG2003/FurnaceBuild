import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { PlatformInviteExperience } from '@/components/platform/invite/PlatformInviteExperience';
import {
  PlatformInvitePreviewFrame,
  type PlatformInvitePreviewViewport,
} from '@/components/platform/invite/PlatformInvitePreviewFrame';
import { buildPlatformInvitePreviewQuote } from '@/lib/platform/invite/preview';
import type {
  PlatformInviteCheckoutInput,
  PlatformInviteCheckoutResult,
  PlatformContractViewData,
} from '@/lib/platform/contract/types';

const ZERO_INSETS = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;

const noop = () => {};

export function PlatformInviteAdminInlinePreview({
  draftData,
  label,
  headerRight,
  showControls,
  initialViewport,
}: {
  draftData: PlatformContractViewData | null;
  label?: string;
  headerRight?: React.ReactNode;
  showControls?: boolean;
  initialViewport?: PlatformInvitePreviewViewport;
}) {
  const loadQuote = useCallback(
    async (paymentRoute: 'card' | 'ach') => {
      if (!draftData) {
        throw new Error('Preview data is not loaded yet.');
      }
      return buildPlatformInvitePreviewQuote(draftData, paymentRoute);
    },
    [draftData],
  );

  const handleCompleteCheckout = useCallback(
    async (_input: PlatformInviteCheckoutInput): Promise<PlatformInviteCheckoutResult> => ({
      kind: 'preview_complete',
      title: 'Checkout preview complete',
      message:
        'This is an internal preview path. No invite was published, no auth user was created, and no Stripe checkout session was started.',
    }),
    [],
  );

  return (
    <PlatformInvitePreviewFrame
      variant="inline"
      label={label}
      headerRight={headerRight}
      showControls={showControls}
      initialViewport={initialViewport}
    >
      {draftData ? (
        <PlatformInviteExperience
          insets={ZERO_INSETS}
          loading={false}
          info={draftData}
          mode="preview"
          embedded
          onContinueExpired={noop}
          loadQuote={loadQuote}
          onCompleteCheckout={handleCompleteCheckout}
        />
      ) : (
        <View className="min-h-full flex-1 items-center justify-center bg-[#121212] px-8">
          <Text className="text-center text-sm text-gray-400 font-instrument">
            Complete the required invite fields to load the live preview.
          </Text>
        </View>
      )}
    </PlatformInvitePreviewFrame>
  );
}
