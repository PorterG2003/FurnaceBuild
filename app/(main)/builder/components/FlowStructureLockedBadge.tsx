import { View, Text } from 'react-native';
import { LockClosedIcon } from 'react-native-heroicons/outline';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  FLOW_STRUCTURE_LOCKED_LABEL,
  FLOW_STRUCTURE_LOCKED_TOOLTIP_BODY,
  FLOW_STRUCTURE_LOCKED_TOOLTIP_TITLE,
} from '@/lib/campaigns/flow/lifecycle';

const STATUS_DOT_COLORS: Record<string, string> = {
  draft: '#9CA3AF',
  running: '#10B981',
  paused: '#F59E0B',
  stopped: '#EF5540',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
};

type FlowStructureLockedBadgeProps = {
  status: string;
};

export function FlowStructureLockedBadge({ status }: FlowStructureLockedBadgeProps) {
  const normalizedStatus =
    status?.toLowerCase() in STATUS_DOT_COLORS ? status.toLowerCase() : 'draft';
  const statusDotColor = STATUS_DOT_COLORS[normalizedStatus] ?? STATUS_DOT_COLORS.draft;
  const statusLabel = STATUS_LABELS[normalizedStatus] ?? STATUS_LABELS.draft;

  return (
    <Tooltip
      placement="bottom"
      content={
        <View style={{ maxWidth: 280 }}>
          <Text className="text-gray-200 font-instrument-medium text-xs">
            {FLOW_STRUCTURE_LOCKED_TOOLTIP_TITLE}
          </Text>
          <Text className="text-gray-400 font-instrument text-xs leading-5 mt-1.5">
            {FLOW_STRUCTURE_LOCKED_TOOLTIP_BODY}
          </Text>
        </View>
      }
    >
      <View className="flex-row items-center rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] overflow-hidden">
        <View className="flex-row items-center gap-2 px-3 py-2">
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              backgroundColor: statusDotColor,
            }}
          />
          <Text className="text-gray-200 font-instrument-medium text-sm">{statusLabel}</Text>
        </View>

        <View className="w-px self-stretch bg-[#3A3A3A]" />

        <View className="flex-row items-center gap-2 px-3 py-2">
          <View className="w-5 h-5 rounded-md bg-amber-500/10 items-center justify-center">
            <LockClosedIcon size={12} color="#FBBF24" />
          </View>
          <Text className="text-gray-400 font-instrument text-sm">{FLOW_STRUCTURE_LOCKED_LABEL}</Text>
        </View>
      </View>
    </Tooltip>
  );
}
