import React from 'react';
import { Image, View } from 'react-native';
import { Logo } from '@/components/ui/branding';

/** Matches `Logo` wordmark sizing used at the top of the invite flow. */
export const PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH = 220;

const WORDMARK_ASPECT_RATIO = 1584 / 396;

export function PlatformInviteLogoBar({
  clientLogoUrl,
  clientLogoScale = 1,
  clientLogoOffsetX = 0,
}: {
  clientLogoUrl?: string | null;
  clientLogoScale?: number;
  clientLogoOffsetX?: number;
}) {
  const trimmedClientLogoUrl = clientLogoUrl?.trim() ?? '';

  if (!trimmedClientLogoUrl) {
    return (
      <View className="w-full items-center" style={{ maxWidth: PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH }}>
        <Logo className="mb-0" variant="white" maxWidth={PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH} />
      </View>
    );
  }

  return (
    <View
      className="w-full flex-row items-center justify-center"
      style={{
        maxWidth: PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH * 2 + 48,
        gap: 20,
      }}
    >
      <View
        className="flex-1 min-w-0 items-center justify-center"
        style={{ maxWidth: PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH,
            aspectRatio: WORDMARK_ASPECT_RATIO,
            transform: [
              { scale: clientLogoScale },
              { translateX: clientLogoOffsetX },
            ],
          }}
        >
          <Image
            source={{ uri: trimmedClientLogoUrl }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
            accessibilityLabel="Client logo"
          />
        </View>
      </View>
      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: '#2A2A2A' }} />
      <View
        className="flex-1 min-w-0 items-center justify-center"
        style={{ maxWidth: PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH }}
      >
        <Logo className="mb-0" variant="white" maxWidth={PLATFORM_INVITE_FURNACE_LOGO_MAX_WIDTH} />
      </View>
    </View>
  );
}
