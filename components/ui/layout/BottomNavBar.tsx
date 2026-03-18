import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import {
  DocumentTextIcon,
  Cog6ToothIcon,
  InboxIcon,
  EnvelopeIcon,
} from 'react-native-heroicons/outline';

const navItems = [
  { path: '/campaigns', icon: DocumentTextIcon },
  { path: '/inbox', icon: InboxIcon },
  { path: '/senders', icon: EnvelopeIcon },
  { path: '/account', icon: Cog6ToothIcon },
];

function isActive(path: string, pathname: string | null) {
  if (path === '/campaigns') {
    return pathname === '/campaigns' || pathname === '/';
  }
  if (path === '/senders') {
    return pathname === '/senders' || (pathname?.startsWith('/senders/') ?? false);
  }
  return pathname === path;
}

const FLOATING_MARGIN = 16;
const BAR_PADDING = 12;
const ICON_GAP = 12;

/** Bottom padding for scrollable content so the last content can scroll above the floating bar */
export const BOTTOM_NAV_SCROLL_PADDING = 80;

export function BottomNavBar() {
  const router = useRouter();
  const pathname = usePathname();

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

  return (
    <View
      className="absolute bottom-0 left-0 right-0 items-center px-4"
      style={{ paddingBottom: FLOATING_MARGIN }}
      pointerEvents="box-none"
    >
      <View
        className="flex-row items-center rounded-full border border-[#2A2A2A] bg-[#1A1A1A]"
        style={[
          {
            padding: BAR_PADDING,
            gap: ICON_GAP,
          },
          shadowStyle,
        ]}
      >
        {navItems.map((item) => {
          const active = isActive(item.path, pathname);
          const Icon = item.icon;
          return (
            <Pressable
              key={item.path}
              onPress={() => router.push(item.path)}
              className="items-center justify-center"
            >
              <View
                className={`rounded-full p-2 ${active ? 'bg-[rgba(243,68,13,0.2)]' : ''}`}
              >
                <Icon
                  size={20}
                  color={active ? '#f85102' : '#9CA3AF'}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
