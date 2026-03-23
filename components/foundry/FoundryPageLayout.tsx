import React from 'react';
import { View, ScrollView, useWindowDimensions } from 'react-native';
import { FoundryNav } from './FoundryNav';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

interface FoundryPageLayoutProps {
  children: React.ReactNode;
  /** When true, wraps children in ScrollView on both breakpoints (default true). */
  scrollable?: boolean;
  contentPadding?: number;
}

/**
 * Foundry shell: own nav, no main Campaigns/Inbox/Senders.
 */
export function FoundryPageLayout({
  children,
  scrollable = true,
  contentPadding = 16,
}: FoundryPageLayoutProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  if (isMobile) {
    return (
      <View className="flex-1 bg-[#121212]">
        <FoundryNav />
        {scrollable ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              padding: contentPadding,
              paddingBottom: contentPadding,
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View className="flex-1">{children}</View>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <FoundryNav />
      <View className="flex-1">
        {scrollable ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: contentPadding, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
