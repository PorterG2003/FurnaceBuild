import { View, Text } from 'react-native';
import { LockClosedIcon } from 'react-native-heroicons/outline';
import { Tooltip } from '@/components/ui/Tooltip';
import { getFlowBadgeConfig } from '@/lib/campaigns/flow/lifecycle';

type FlowStructureLockedBadgeProps = {
  status: string;
};

export function FlowStructureLockedBadge({ status }: FlowStructureLockedBadgeProps) {
  const normalizedStatus = status?.toLowerCase() ?? 'draft';
  const badge = getFlowBadgeConfig(normalizedStatus as 'running' | 'paused' | 'stopped');
  if (!badge) return null;

  const badgeContent = (
    <View className="flex-row items-center gap-2 rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] px-3 py-2">
      {badge.showLockIcon ? (
        <View className="w-5 h-5 rounded-md bg-amber-500/10 items-center justify-center">
          <LockClosedIcon size={12} color="#FBBF24" />
        </View>
      ) : null}
      <Text className="text-gray-400 font-instrument text-sm">{badge.secondaryLabel}</Text>
    </View>
  );

  if (!badge.tooltip) {
    return badgeContent;
  }

  return (
    <Tooltip
      placement="bottom"
      content={
        <View style={{ maxWidth: 220 }}>
          <Text className="text-gray-400 font-instrument text-xs leading-5">{badge.tooltip}</Text>
        </View>
      }
    >
      {badgeContent}
    </Tooltip>
  );
}

export default FlowStructureLockedBadge;
