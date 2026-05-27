import { useMemo, type ComponentType } from 'react';
import { View, Text } from 'react-native';
import {
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
} from 'react-native-heroicons/outline';
import { Card } from '@/components/ui/Card';
import { formatRelativeActivity } from '@/lib/dates/formatRelativeActivity';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { useLeadDetailLayout } from './leadDetailLayout';

type SummaryMetric = {
  key: string;
  title: string;
  subtitle: string;
  value: string;
  icon: ComponentType<{ size?: number; color?: string }>;
  color: string;
};

function LeadDetailMetricCard({
  metric,
  compact,
  layout,
}: {
  metric: SummaryMetric;
  compact: boolean;
  layout: 'stack' | 'row';
}) {
  const Icon = metric.icon;
  return (
    <Card
      variant="card"
      className={layout === 'stack' ? 'w-full p-4' : 'flex-1 min-w-0 p-4'}
    >
      <View className="flex-row items-center gap-2 mb-2">
        <View
          className="rounded-lg items-center justify-center"
          style={{
            width: compact ? 28 : 32,
            height: compact ? 28 : 32,
            backgroundColor: `${metric.color}18`,
          }}
        >
          <Icon size={compact ? 16 : 18} color={metric.color} />
        </View>
        <Text
          className={`text-white font-instrument-semibold flex-1 ${compact ? 'text-sm' : 'text-base'}`}
          numberOfLines={2}
        >
          {metric.title}
        </Text>
      </View>
      <Text className="text-gray-500 font-instrument text-xs mb-3" numberOfLines={2}>
        {metric.subtitle}
      </Text>
      <Text
        className={`font-instrument-semibold ${compact ? 'text-2xl' : 'text-3xl'}`}
        style={{ color: metric.color }}
        numberOfLines={1}
      >
        {metric.value}
      </Text>
    </Card>
  );
}

export function LeadDetailSummary({ detail }: { detail: AccountLeadDetail }) {
  const { isMobile } = useLeadDetailLayout();

  const metrics = useMemo((): SummaryMetric[] => {
    const activeCount = detail.person.memberships.filter((m) => m.enrollmentState === 'active').length;
    const threadsWithReply = detail.threads.filter((t) => t.hasReply).length;

    const activityTimestamps = [
      ...detail.person.memberships.map((m) => m.lastActivityAt),
      ...detail.threads.map((t) => t.lastMessageAt),
    ].filter(Boolean);
    const latestActivity = activityTimestamps.sort((a, b) => b.localeCompare(a))[0];

    const campaignSubtitle =
      detail.person.memberships.length === 0
        ? 'Not in any campaigns'
        : activeCount > 0
          ? `${activeCount} in progress`
          : 'No active enrollments';

    const conversationSubtitle =
      detail.threads.length === 0
        ? 'No inbox threads'
        : threadsWithReply > 0
          ? `${threadsWithReply} with replies`
          : 'No replies yet';

    const activitySubtitle = latestActivity
      ? new Date(latestActivity).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : 'No recorded activity';

    return [
      {
        key: 'campaigns',
        title: 'Campaigns',
        subtitle: campaignSubtitle,
        value: String(detail.person.memberships.length),
        icon: UserGroupIcon,
        color: '#a78bfa',
      },
      {
        key: 'conversations',
        title: 'Conversations',
        subtitle: conversationSubtitle,
        value: String(detail.threads.length),
        icon: ChatBubbleLeftRightIcon,
        color: '#10b981',
      },
      {
        key: 'activity',
        title: 'Last activity',
        subtitle: activitySubtitle,
        value: latestActivity ? formatRelativeActivity(latestActivity) : '—',
        icon: ClockIcon,
        color: '#f59e0b',
      },
    ];
  }, [detail]);

  return (
    <View className={`w-full ${isMobile ? 'flex-col gap-3' : 'flex-row gap-4'}`}>
      {metrics.map((metric) => (
        <LeadDetailMetricCard
          key={metric.key}
          metric={metric}
          compact={isMobile}
          layout={isMobile ? 'stack' : 'row'}
        />
      ))}
    </View>
  );
}
