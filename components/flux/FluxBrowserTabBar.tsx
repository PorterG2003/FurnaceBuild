import type { ComponentType } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { cn } from '@/lib/cn';

export type FluxBrowserTabItem = {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number; color?: string }>;
};

type FluxBrowserTabBarProps = {
  tabs: FluxBrowserTabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** `sidebar`: strip matches editor column (no nested “toolbar” look). */
  appearance?: 'nested' | 'sidebar';
};

/**
 * Horizontal “browser tab” strip for Flux manual editors: inactive tabs sit on a dark toolbar;
 * active tab lifts with a lighter surface that visually continues into the panel below.
 */
export function FluxBrowserTabBar({
  tabs,
  activeTab,
  onTabChange,
  appearance = 'nested',
}: FluxBrowserTabBarProps) {
  const stripClass =
    appearance === 'sidebar'
      ? 'self-stretch min-w-0 bg-[#1a1a1a] border-b border-[#2A2A2A]'
      : 'self-stretch min-w-0 bg-[#141414] border-b border-[#2A2A2A]';
  return (
    <View className={stripClass}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={Platform.OS !== 'web'}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          paddingHorizontal: 4,
          paddingTop: 6,
          paddingBottom: 0,
          gap: 2,
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onTabChange(tab.id)}
              style={{
                marginBottom: isActive ? -1 : 0,
                zIndex: isActive ? 2 : 0,
              }}
              className={cn(
                'flex-row items-center gap-1 rounded-t-md border border-b-0 px-2 max-w-[min(200px,92vw)] shrink-0',
                isActive
                  ? 'pt-2 pb-2 border-[#2A2A2A] bg-[#1a1a1a]'
                  : 'pt-1.5 pb-1.5 border-[#2A2A2A]/50 bg-[#1f1f1f]',
              )}
            >
              {Icon ? <Icon size={12} color={isActive ? '#a1a1aa' : '#71717a'} /> : null}
              <Text
                numberOfLines={1}
                className={cn(
                  'text-[11px] font-instrument-semibold',
                  isActive ? 'text-gray-100' : 'text-gray-500',
                )}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
