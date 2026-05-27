import React, { type ReactNode } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Breadcrumb } from './Breadcrumb';
import { MobileHeaderBackButton } from './MobileHeaderBackButton';
import { LAYOUT_BREAKPOINT } from './constants';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  /** Web only: open breadcrumb link in a new tab. */
  openInNewTab?: boolean;
}

interface DetailPageHeaderProps {
  breadcrumbItems: BreadcrumbItem[];
  backHref: string;
  title: string;
  /** Mobile only: optional subtitle (e.g. email) shown below the title */
  subtitle?: string | null;
  actions?: ReactNode;
  /** Mobile only: rendered on the right of the first row (e.g. three-dots actions button) */
  mobileRightAction?: ReactNode;
  /** When set, mobile back button calls this instead of navigating to backHref (e.g. for same-page drill-in) */
  onBack?: () => void;
  /** Mobile only: when set, title/subtitle become pressable (e.g. open lead detail). */
  onTitlePress?: () => void;
}

export function DetailPageHeader({
  breadcrumbItems,
  backHref,
  title,
  subtitle,
  actions,
  mobileRightAction,
  onBack,
  onTitlePress,
}: DetailPageHeaderProps) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const isMobile = width < LAYOUT_BREAKPOINT;

  if (isMobile) {
    const handleBack = () => (onBack != null ? onBack() : router.push(backHref));
    return (
      <View
        className="bg-[#121212] pb-4 relative"
        style={{ width: '100%', alignSelf: 'stretch', flexDirection: 'row', alignItems: 'stretch' }}
      >
        <View style={{ flex: 1, flexDirection: 'column', gap: 12, justifyContent: 'flex-start' }}>
          <MobileHeaderBackButton onPress={handleBack} />
          <View style={{ gap: 0 }}>
            {onTitlePress ? (
              <Pressable onPress={onTitlePress} accessibilityLabel="View lead profile">
                <Text
                  className="text-white font-instrument-semibold text-2xl"
                  numberOfLines={2}
                >
                  {title}
                </Text>
                {subtitle ? (
                  <Text
                    className="text-gray-500 font-instrument text-sm"
                    numberOfLines={1}
                    style={{ marginTop: 2 }}
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </Pressable>
            ) : (
              <>
                <Text
                  className="text-white font-instrument-semibold text-2xl"
                  numberOfLines={2}
                >
                  {title}
                </Text>
                {subtitle ? (
                  <Text
                    className="text-gray-500 font-instrument text-sm"
                    numberOfLines={1}
                    style={{ marginTop: 2 }}
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </>
            )}
          </View>
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
      {actions != null ? <View className="flex-row items-center gap-2">{actions}</View> : null}
    </View>
  );
}
