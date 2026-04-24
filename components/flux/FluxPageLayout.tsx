import React from 'react';
import { View, ScrollView, useWindowDimensions } from 'react-native';
import { FluxNav } from './FluxNav';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

interface FluxPageLayoutProps {
  children: React.ReactNode;
  scrollable?: boolean;
  contentPadding?: number;
}

export function FluxPageLayout({
  children,
  scrollable = true,
  contentPadding = 16,
}: FluxPageLayoutProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  if (isMobile) {
    return (
      <View className="flex-1 bg-[#121212]">
        <FluxNav />
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
      <FluxNav />
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
