import React, { type ReactNode } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeftIcon } from 'react-native-heroicons/outline';
import { Breadcrumb } from './Breadcrumb';
import { LAYOUT_BREAKPOINT } from './constants';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface DetailPageHeaderProps {
  breadcrumbItems: BreadcrumbItem[];
  backHref: string;
  title: string;
  actions?: ReactNode;
  /** Mobile only: rendered on the right of the first row (e.g. three-dots actions button) */
  mobileRightAction?: ReactNode;
}

export function DetailPageHeader({
  breadcrumbItems,
  backHref,
  title,
  actions,
  mobileRightAction,
}: DetailPageHeaderProps) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const isMobile = width < LAYOUT_BREAKPOINT;

  if (isMobile) {
    return (
      <View
        className="bg-[#121212] pb-4 relative"
        style={{ width: '100%', alignSelf: 'stretch', flexDirection: 'row', alignItems: 'stretch' }}
      >
        <View style={{ flex: 1, flexDirection: 'column', gap: 12, justifyContent: 'flex-start' }}>
          <Pressable
            onPress={() => router.push(backHref)}
            className="flex-row items-center py-0.5 -ml-1"
            accessibilityLabel="Back"
          >
            <ChevronLeftIcon size={18} color="#9CA3AF" />
            <Text className="text-gray-400 font-instrument text-sm ml-1">Back</Text>
          </Pressable>
          <Text
            className="text-white font-instrument-semibold text-2xl"
            numberOfLines={2}
          >
            {title}
          </Text>
        </View>
        {mobileRightAction != null ? (
          <View style={{ justifyContent: 'center' }}>{mobileRightAction}</View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="bg-[#121212] border-b border-[#2A2A2A] px-6 py-4 z-10 flex-row items-center justify-between">
      <Breadcrumb items={breadcrumbItems} />
      {actions != null ? actions : null}
    </View>
  );
}
