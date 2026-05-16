import React, { useEffect, useState } from 'react';
import { View, Pressable, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRouter, usePathname } from 'expo-router';
import {
  MegaphoneIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  InboxIcon,
  EnvelopeIcon,
} from 'react-native-heroicons/outline';

const navItems = [
  { path: '/campaigns', icon: MegaphoneIcon },
  { path: '/metrics', icon: ChartBarIcon },
  { path: '/inbox', icon: InboxIcon },
  { path: '/senders', icon: EnvelopeIcon },
  { path: '/account', icon: Cog6ToothIcon },
];

function isActive(path: string, pathname: string | null) {
  if (path === '/campaigns') {
    return pathname === '/campaigns';
  }
  if (path === '/inbox') {
    return pathname === '/inbox' || pathname === '/';
  }
  if (path === '/senders') {
    return pathname === '/senders' || (pathname?.startsWith('/senders/') ?? false);
  }
  return pathname === path;
}

function getActiveIndex(pathname: string | null): number {
  const idx = navItems.findIndex((item) => isActive(item.path, pathname));
  return idx === -1 ? 0 : idx;
}

const FLOATING_MARGIN = 16;
const BAR_PADDING = 6;
const ICON_GAP = 12;
const ICON_SIZE = 22;
const ACTIVE_CIRCLE_PADDING = 12;
const ICON_CELL_SIZE = ICON_SIZE + ACTIVE_CIRCLE_PADDING * 2;

const TRANSITION_DURATION = 280;
const EASING_CSS = 'cubic-bezier(0.33, 1, 0.68, 1)';

function indicatorX(index: number) {
  return BAR_PADDING + index * (ICON_CELL_SIZE + ICON_GAP);
}

const INDICATOR_BASE = {
  position: 'absolute' as const,
  top: BAR_PADDING,
  left: 0,
  width: ICON_CELL_SIZE,
  height: ICON_CELL_SIZE,
  borderRadius: ICON_CELL_SIZE / 2,
  backgroundColor: 'rgba(243, 68, 13, 0.2)',
  pointerEvents: 'none' as const,
};

/** Bottom padding for scrollable content so the last content can scroll above the floating bar */
export const BOTTOM_NAV_SCROLL_PADDING = 80;

// Module-level: survives page unmounts so the next mount can animate from the old position
let persistedActiveIndex = 0;

// ─── Web indicator: CSS transition ───────────────────────────────────────────
function WebIndicator({ activeIndex }: { activeIndex: number }) {
  // Start at previous page's position; update after mount so CSS transition fires
  const [displayX, setDisplayX] = useState(() => indicatorX(persistedActiveIndex));

  useEffect(() => {
    const targetX = indicatorX(activeIndex);
    // Defer update so Safari paints the "from" state before transitioning to "to"
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setDisplayX(targetX);
      });
    });
    persistedActiveIndex = activeIndex;
    return () => cancelAnimationFrame(id);
  }, [activeIndex]);

  return (
    <View
      style={[
        INDICATOR_BASE,
        {
          transform: [{ translateX: displayX }, { translateZ: 0 }],
          // CSS properties passed through by react-native-web
          ...(({
            transitionProperty: 'transform',
            transitionDuration: `${TRANSITION_DURATION}ms`,
            transitionTimingFunction: EASING_CSS,
            willChange: 'transform',
          }) as any),
        },
      ]}
    />
  );
}

// ─── Native indicator: Reanimated withTiming ──────────────────────────────────
function NativeIndicator({ activeIndex }: { activeIndex: number }) {
  // Start at previous page's position so the slide-in plays on mount
  const translateX = useSharedValue(indicatorX(persistedActiveIndex));

  useEffect(() => {
    translateX.value = withTiming(indicatorX(activeIndex), {
      duration: TRANSITION_DURATION,
      easing: Easing.out(Easing.cubic),
    });
    persistedActiveIndex = activeIndex;
  }, [activeIndex]);

  const indicatorStyle = useAnimatedStyle(() => ({
    ...INDICATOR_BASE,
    transform: [{ translateX: translateX.value }],
  }));

  return <Animated.View style={indicatorStyle} />;
}

export function BottomNavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const activeIndex = getActiveIndex(pathname);

  const shadowStyle =
    Platform.OS === 'web'
      ? { boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 12,
          elevation: 8,
        };

  const Indicator = Platform.OS === 'web' ? WebIndicator : NativeIndicator;

  return (
    <View
      className="absolute bottom-0 left-0 right-0 items-center px-4"
      style={{ paddingBottom: FLOATING_MARGIN }}
      pointerEvents="box-none"
    >
      <View
        className="rounded-full border border-[#2A2A2A] bg-[#1A1A1A]"
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            padding: BAR_PADDING,
            gap: ICON_GAP,
            position: 'relative',
          },
          shadowStyle,
        ]}
      >
        <Indicator activeIndex={activeIndex} />

        {navItems.map((item, index) => {
          const active = index === activeIndex;
          const Icon = item.icon;
          return (
            <Pressable
              key={item.path}
              onPress={() => router.push(item.path)}
              className="items-center justify-center"
              style={{ width: ICON_CELL_SIZE, height: ICON_CELL_SIZE }}
            >
              <Icon
                size={ICON_SIZE}
                color={active ? '#f85102' : '#9CA3AF'}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
