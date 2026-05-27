import { useMemo, type ComponentType } from 'react';
import { View, Text } from 'react-native';
import {
  UserIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  ChevronRightIcon,
} from 'react-native-heroicons/outline';
import { Card } from '@/components/ui/Card';
import type { AccountLeadDetail } from '@/lib/leads/types';
import type { LeadDetailSectionId } from './leadDetailMobileSections';
import { LEAD_DETAIL_SECTION_TITLES } from './leadDetailMobileSections';
import { getLeadDetailHubStats } from './leadDetailHubStats';

type SectionNavItem = {
  id: LeadDetailSectionId;
  title: string;
  icon: ComponentType<{ size?: number; color?: string }>;
  color: string;
  badge?: string;
};

export function LeadDetailMobileNav({
  detail,
  onSectionPress,
}: {
  detail: AccountLeadDetail;
  onSectionPress: (section: LeadDetailSectionId) => void;
}) {
  const items = useMemo((): SectionNavItem[] => {
    const { membershipCount, threadCount } = getLeadDetailHubStats(detail);

    return [
      {
        id: 'overview',
        title: LEAD_DETAIL_SECTION_TITLES.overview,
        icon: UserIcon,
        color: '#f85102',
      },
      {
        id: 'campaigns',
        title: LEAD_DETAIL_SECTION_TITLES.campaigns,
        icon: UserGroupIcon,
        color: '#a78bfa',
        badge: membershipCount > 0 ? String(membershipCount) : undefined,
      },
      {
        id: 'conversations',
        title: LEAD_DETAIL_SECTION_TITLES.conversations,
        icon: ChatBubbleLeftRightIcon,
        color: '#10b981',
        badge: threadCount > 0 ? String(threadCount) : undefined,
      },
      {
        id: 'activity',
        title: LEAD_DETAIL_SECTION_TITLES.activity,
        icon: ClockIcon,
        color: '#f59e0b',
      },
    ];
  }, [detail]);

  return (
    <View className="gap-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.id}
            variant="card"
            onPress={() => onSectionPress(item.id)}
            className="p-4"
          >
            <View className="flex-row items-center gap-3">
              <Icon size={22} color={item.color} />
              <Text className="flex-1 text-white font-instrument-semibold text-base">{item.title}</Text>
              {item.badge ? (
                <Text className="text-sm font-instrument-medium text-gray-500 tabular-nums">{item.badge}</Text>
              ) : null}
              <ChevronRightIcon size={18} color="#6b7280" />
            </View>
          </Card>
        );
      })}
    </View>
  );
}
