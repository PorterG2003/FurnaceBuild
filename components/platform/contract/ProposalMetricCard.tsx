import React, { type ComponentType } from 'react';
import { Text, View } from 'react-native';
import {
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  ServerStackIcon,
  UserGroupIcon,
} from 'react-native-heroicons/outline';

type MetricPresentation = {
  icon: ComponentType<{ size?: number; color?: string }>;
  subtitle: string;
};

function getMetricPresentation(label: string): MetricPresentation {
  const normalized = label.toLowerCase();

  if (/consulting|strategy|development|1:1/.test(normalized)) {
    return {
      icon: ChatBubbleLeftRightIcon,
      subtitle: 'Strategy and campaign support included with your plan',
    };
  }

  if (/lead|sourcing|byol|enrichment/.test(normalized)) {
    return {
      icon: UserGroupIcon,
      subtitle: 'How leads are sourced for your campaigns',
    };
  }

  if (/standby|backup/.test(normalized)) {
    return {
      icon: ServerStackIcon,
      subtitle: 'Hot backup capacity ready to rotate in',
    };
  }

  if (/volume|email|month/.test(normalized)) {
    return {
      icon: PaperAirplaneIcon,
      subtitle: 'Projected monthly outreach at plan send rate',
    };
  }

  if (/sending|capacity|inbox/.test(normalized)) {
    return {
      icon: EnvelopeIcon,
      subtitle: 'Active sending inboxes included in your plan',
    };
  }

  return {
    icon: ChartBarIcon,
    subtitle: label,
  };
}

export function ProposalMetricCard({
  title,
  subtitle,
  value,
  accentColor,
  compact = false,
}: {
  title: string;
  subtitle?: string | null;
  value: string;
  accentColor: string;
  compact?: boolean;
}) {
  const presentation = getMetricPresentation(title);
  const Icon = presentation.icon;
  const resolvedSubtitle = subtitle === undefined ? presentation.subtitle : subtitle;

  return (
    <View className={compact ? 'w-full' : 'flex-1 min-w-0'}>
      <View className="flex-row items-center gap-2 mb-2">
        <Icon size={compact ? 16 : 18} color={accentColor} />
        <Text
          selectable={false}
          className={`text-gray-200 font-instrument-semibold flex-1 ${compact ? 'text-sm' : 'text-base'}`}
          numberOfLines={2}
        >
          {title}
        </Text>
      </View>
      <Text
        selectable={false}
        className={`font-instrument-semibold ${compact ? 'text-2xl' : 'text-3xl'}`}
        style={{ color: accentColor }}
        numberOfLines={2}
      >
        {value}
      </Text>
      {resolvedSubtitle ? (
        <Text selectable={false} className="text-gray-500 font-instrument text-xs mt-2" numberOfLines={3}>
          {resolvedSubtitle}
        </Text>
      ) : null}
    </View>
  );
}
