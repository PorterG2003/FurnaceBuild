import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import type { LeadsWorkbenchActionGroup } from '@/lib/leads/workbench/buildLeadsWorkbenchActionGroups';
import { LeadsWorkbenchActionsMenu } from './LeadsWorkbenchActionsMenu';

export function LeadsActionBar({
  scopeLabel,
  groups,
  onClearSelection,
  actionsDisabled = false,
  actionsAccessibilityLabel = 'Lead actions',
}: {
  scopeLabel: string | null;
  groups: LeadsWorkbenchActionGroup[];
  onClearSelection?: () => void;
  actionsDisabled?: boolean;
  actionsAccessibilityLabel?: string;
}) {
  if (!scopeLabel) return null;

  const menuDisabled =
    actionsDisabled || groups.length === 0 || groups.every((group) => group.items.every((item) => item.disabled));

  return (
    <View className="border border-[#2A2A2A] bg-[#181818] rounded-xl p-3 flex-row items-center justify-between gap-3 flex-wrap">
      <Text className="text-white font-instrument text-sm flex-1 min-w-0">{scopeLabel}</Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <LeadsWorkbenchActionsMenu
          groups={groups}
          disabled={menuDisabled}
          accessibilityLabel={actionsAccessibilityLabel}
        />
        {onClearSelection ? (
          <Button variant="secondary" size="sm" onPress={onClearSelection}>
            Clear
          </Button>
        ) : null}
      </View>
    </View>
  );
}
