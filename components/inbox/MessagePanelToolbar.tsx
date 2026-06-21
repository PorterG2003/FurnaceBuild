import { useMemo, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import {
  getInboxThreadToolbarPriority,
  type InboxThreadToolbarAction,
  type InboxThreadToolbarActionKey,
} from '@/lib/inbox';
import { RowOverflowMenu, type RowOverflowMenuItem } from '@/components/ui/RowOverflowMenu';
import { computeToolbarOverflowSplit } from '@/lib/ui/toolbarOverflow';
import { MessageToolbarActionButton } from './MessageToolbarActionButton';
import { INBOX_THREAD_TOOLBAR_ICON_MAP } from './inboxThreadToolbarIcons';
import { getMessageToolbarToneColors, MESSAGE_TOOLBAR_INLINE_ACTION_WIDTH } from './messageToolbarStyles';

interface MessagePanelToolbarProps {
  actions: InboxThreadToolbarAction[];
  gap?: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

const OVERFLOW_TRIGGER_WIDTH = 32;

function getOverflowItemColors(tone: InboxThreadToolbarAction['tone']) {
  const styles = getMessageToolbarToneColors(tone ?? 'default');
  return { iconColor: styles.iconColor, textColor: styles.textColor };
}

export function MessagePanelToolbar({ actions, gap = 8, prefix, suffix }: MessagePanelToolbarProps) {
  /** Full flex allocation for this toolbar (actions + suffix). */
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const [prefixWidth, setPrefixWidth] = useState(0);
  const [suffixWidth, setSuffixWidth] = useState(0);

  const orderedActions = useMemo(
    () => [...actions].sort((a, b) => getInboxThreadToolbarPriority(a.key) - getInboxThreadToolbarPriority(b.key)),
    [actions],
  );

  const hasPrefix = prefix != null;
  const hasSuffix = suffix != null;
  const prefixReserve = hasPrefix ? prefixWidth + (orderedActions.length > 0 ? gap : 0) : 0;
  const suffixReserve = hasSuffix ? suffixWidth + (orderedActions.length > 0 || hasPrefix ? gap : 0) : 0;
  const actionBudget = Math.max(0, toolbarWidth - prefixReserve - suffixReserve);

  const { visibleKeys, overflowKeys } = useMemo(() => {
    if (orderedActions.length === 0) {
      return {
        visibleKeys: [] as MessagePanelToolbarActionKey[],
        overflowKeys: [] as MessagePanelToolbarActionKey[],
      };
    }

    if (actionBudget <= 0) {
      return {
        visibleKeys: [] as MessagePanelToolbarActionKey[],
        overflowKeys: orderedActions.map((action) => action.key),
      };
    }

    const splitItems = orderedActions.map((action) => ({
      key: action.key,
      priority: getInboxThreadToolbarPriority(action.key),
      width: MESSAGE_TOOLBAR_INLINE_ACTION_WIDTH,
    }));

    return computeToolbarOverflowSplit(splitItems, actionBudget, {
      gap,
      overflowTriggerWidth: OVERFLOW_TRIGGER_WIDTH,
    }) as { visibleKeys: MessagePanelToolbarActionKey[]; overflowKeys: MessagePanelToolbarActionKey[] };
  }, [actionBudget, gap, orderedActions]);

  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const actionMap = useMemo(
    () => Object.fromEntries(orderedActions.map((action) => [action.key, action])) as Record<MessagePanelToolbarActionKey, InboxThreadToolbarAction>,
    [orderedActions],
  );

  const overflowItems = useMemo<RowOverflowMenuItem[]>(
    () =>
      overflowKeys.map((key) => {
        const action = actionMap[key];
        const { iconColor, textColor } = getOverflowItemColors(action.tone);
        return {
          key: action.key,
          label: action.label,
          icon: INBOX_THREAD_TOOLBAR_ICON_MAP[action.iconKey],
          onPress: action.onPress,
          tone: action.tone === 'destructive' ? 'destructive' : 'default',
          iconColor,
          textColor,
          accessibilityLabel: action.accessibilityLabel,
        };
      }),
    [actionMap, overflowKeys],
  );

  const handleToolbarLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    setToolbarWidth((current) => (current === nextWidth ? current : nextWidth));
  };

  const handleSuffixLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    setSuffixWidth((current) => (current === nextWidth ? current : nextWidth));
  };

  const handlePrefixLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    setPrefixWidth((current) => (current === nextWidth ? current : nextWidth));
  };

  if (orderedActions.length === 0 && !hasSuffix) {
    return null;
  }

  return (
    <View className="flex-row flex-1 min-w-0 items-center gap-2" onLayout={handleToolbarLayout}>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-end gap-2 min-w-0">
          {hasPrefix ? (
            <View className="shrink-0 min-w-0" onLayout={handlePrefixLayout}>
              {prefix}
            </View>
          ) : null}
          {orderedActions.map((action) =>
            visibleSet.has(action.key) ? (
              <MessageToolbarActionButton
                key={action.key}
                label={action.label}
                icon={INBOX_THREAD_TOOLBAR_ICON_MAP[action.iconKey]}
                onPress={action.onPress}
                tone={action.tone}
                accessibilityLabel={action.accessibilityLabel}
                trailingChevron={action.trailingChevron}
                compactLabelColor={action.compactLabelColor}
                maxWidth={MESSAGE_TOOLBAR_INLINE_ACTION_WIDTH}
              />
            ) : null,
          )}
        </View>
      </View>

      {hasSuffix ? (
        <View className="shrink-0" onLayout={handleSuffixLayout}>
          {suffix}
        </View>
      ) : null}
      {overflowItems.length > 0 ? (
        <RowOverflowMenu
          items={overflowItems}
          horizontalAlign="end"
          menuMinWidth={180}
          triggerAccessibilityLabel="More message actions"
          triggerContainerClassName="shrink-0"
          triggerVariant="mobile-actions"
        />
      ) : null}
    </View>
  );
}
