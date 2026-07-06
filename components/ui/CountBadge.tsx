import React from 'react';
import { Platform, Text, View } from 'react-native';
import {
  OPEN_CONVERSATION_ACTION_TEXT,
  OPEN_CONVERSATION_COLOR,
} from '@/components/inbox/inboxConstants';

function formatCount(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}

type CountBadgeProps = {
  count: number;
  size?: 'sm' | 'nav' | 'md';
  /** Solid orange pill (default) or muted outline for highlighted rows. */
  variant?: 'solid' | 'muted';
  /** Dark ring to separate overlay badges from nav backgrounds. */
  ring?: boolean;
  ringColor?: string;
};

const SIZE_STYLES = {
  sm: {
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    fontSize: 10,
    paddingHorizontal: 2,
    ringWidth: 1.5,
  },
  nav: {
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    fontSize: 12,
    paddingHorizontal: 5,
    ringWidth: 2,
  },
  md: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    fontSize: 11,
    paddingHorizontal: 4,
    ringWidth: 2,
  },
} as const;

export function CountBadge({
  count,
  size = 'sm',
  variant = 'solid',
  ring = false,
  ringColor = '#1A1A1A',
}: CountBadgeProps) {
  if (count <= 0) return null;

  const dimensions = SIZE_STYLES[size];
  const isMuted = variant === 'muted';

  return (
    <View
      style={{
        minWidth: dimensions.minWidth,
        height: dimensions.height,
        borderRadius: dimensions.borderRadius,
        backgroundColor: isMuted ? 'rgba(243, 68, 13, 0.2)' : OPEN_CONVERSATION_COLOR,
        borderWidth: isMuted ? 1 : ring ? dimensions.ringWidth : 0,
        borderColor: isMuted
          ? 'rgba(243, 68, 13, 0.5)'
          : ring
            ? ringColor
            : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: dimensions.paddingHorizontal,
      }}
    >
      <Text
        className="font-instrument-semibold tabular-nums"
        style={{
          color: isMuted ? OPEN_CONVERSATION_ACTION_TEXT : '#FFFFFF',
          fontSize: dimensions.fontSize,
          lineHeight: dimensions.fontSize + 1,
          ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
        }}
      >
        {formatCount(count)}
      </Text>
    </View>
  );
}

type CountBadgeOverlayProps = CountBadgeProps & {
  offsetTop?: number;
  offsetRight?: number;
};

export function CountBadgeOverlay({
  count,
  size = 'nav',
  variant = 'solid',
  ring = true,
  ringColor = '#1A1A1A',
  offsetTop = 0,
  offsetRight = 0,
}: CountBadgeOverlayProps) {
  if (count <= 0) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: offsetTop,
        right: offsetRight,
        zIndex: 1,
      }}
    >
      <CountBadge
        count={count}
        size={size}
        variant={variant}
        ring={ring}
        ringColor={ringColor}
      />
    </View>
  );
}

type IconBadgeAnchorProps = {
  children: React.ReactNode;
  count: number;
  iconSize: number;
  ringColor?: string;
  /** Fraction of badge size to offset outward from top-right corner (default: sidebar nav). */
  offsetFactor?: number;
};

/** Positions a notification-style count badge at the top-right of an icon. */
export function IconBadgeAnchor({
  children,
  count,
  iconSize,
  ringColor = '#1A1A1A',
  offsetFactor = 0.8,
}: IconBadgeAnchorProps) {
  const badgeHeight = SIZE_STYLES.nav.height;
  const ringWidth = SIZE_STYLES.nav.ringWidth;
  const badgeOuter = badgeHeight + ringWidth * 2;
  const offset = Math.round(badgeOuter * offsetFactor);

  return (
    <View
      style={{
        width: iconSize,
        height: iconSize,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {children}
      {count > 0 ? (
        <CountBadgeOverlay
          count={count}
          size="nav"
          ringColor={ringColor}
          offsetTop={-offset}
          offsetRight={-offset}
        />
      ) : null}
    </View>
  );
}
