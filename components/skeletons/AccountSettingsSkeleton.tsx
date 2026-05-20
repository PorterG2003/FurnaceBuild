import { useEffect, useRef, type ReactNode } from 'react';
import { View, Animated } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { BalancedTwoColumnLayout, type BalancedSection } from '@/components/ui/layout';

const useNativeDriver = typeof window === 'undefined';
const STAGGER_DELAY_MS = 60;

const DESKTOP_COLUMN_MAX_WIDTH = 440;
const DESKTOP_TWO_COLUMN_WIDTH = DESKTOP_COLUMN_MAX_WIDTH * 2 + 24;

function StaggeredFadeIn({ index, children }: { index: number; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver,
      }).start();
    }, index * STAGGER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [index, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function AccountSectionCardSkeleton({ index, tall = false }: { index: number; tall?: boolean }) {
  return (
    <StaggeredFadeIn index={index}>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 mb-8">
        <Skeleton style={{ width: 160, height: 20, borderRadius: 4, marginBottom: 16 }} />
        <Skeleton style={{ width: '100%', height: 14, borderRadius: 4, marginBottom: 12, maxWidth: 280 }} />
        <Skeleton style={{ width: '100%', height: 40, borderRadius: 8, marginBottom: 12 }} />
        {tall ? (
          <>
            <Skeleton style={{ width: '100%', height: 40, borderRadius: 8, marginBottom: 12 }} />
            <Skeleton style={{ width: 120, height: 32, borderRadius: 8 }} />
          </>
        ) : (
          <Skeleton style={{ width: 100, height: 32, borderRadius: 8 }} />
        )}
      </View>
    </StaggeredFadeIn>
  );
}

function buildSkeletonSections(includeSmartlead: boolean): BalancedSection[] {
  const sections: BalancedSection[] = [
    {
      id: 'profile',
      groupLabel: 'Profile & account',
      content: <AccountSectionCardSkeleton index={0} />,
    },
    {
      id: 'notifications',
      groupLabel: 'Profile & account',
      content: <AccountSectionCardSkeleton index={1} tall />,
    },
    {
      id: 'company',
      groupLabel: 'Team',
      content: <AccountSectionCardSkeleton index={2} />,
    },
    {
      id: 'api-keys',
      groupLabel: 'Integrations',
      content: <AccountSectionCardSkeleton index={3} tall />,
    },
    {
      id: 'webhooks',
      groupLabel: 'Integrations',
      content: <AccountSectionCardSkeleton index={4} tall />,
    },
    {
      id: 'team-members',
      groupLabel: 'Team',
      content: <AccountSectionCardSkeleton index={5} tall />,
    },
    {
      id: 'block-list',
      groupLabel: 'Tools',
      content: <AccountSectionCardSkeleton index={6} />,
    },
  ];

  if (includeSmartlead) {
    sections.push({
      id: 'smartlead',
      groupLabel: 'Tools',
      content: <AccountSectionCardSkeleton index={7} />,
    });
  }

  return sections;
}

export interface AccountSettingsSkeletonProps {
  isMobile: boolean;
  includeSmartlead?: boolean;
}

export function AccountSettingsSkeleton({
  isMobile,
  includeSmartlead = false,
}: AccountSettingsSkeletonProps) {
  const sections = buildSkeletonSections(includeSmartlead);

  return (
    <BalancedTwoColumnLayout
      sections={sections}
      isDesktop={!isMobile}
      compact={isMobile}
      contentMaxWidth={DESKTOP_TWO_COLUMN_WIDTH}
      columnMaxWidth={DESKTOP_COLUMN_MAX_WIDTH}
    />
  );
}
