import { useMemo, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { RowOverflowMenu, type RowOverflowMenuItem } from '@/components/ui/RowOverflowMenu';
import { computeToolbarOverflowSplit } from '@/lib/ui/toolbarOverflow';
import type { MessageToolbarActionTone, MessageToolbarMenuIcon } from './MessageToolbarActionButton';
import { getMessageToolbarToneColors } from './MessageToolbarActionButton';

export const MESSAGE_TOOLBAR_ORDER = ['close', 'open', 'block', 'ooo', 'replace', 'tags'] as const;

export type MessagePanelToolbarActionKey = (typeof MESSAGE_TOOLBAR_ORDER)[number];

export interface MessagePanelToolbarAction {
  key: MessagePanelToolbarActionKey;
  hidden?: boolean;
  label: string;
  icon: MessageToolbarMenuIcon;
  onPress: () => void;
  tone?: MessageToolbarActionTone;
  renderInline: (measureOnly?: boolean) => ReactNode;
  accessibilityLabel?: string;
}

interface MessagePanelToolbarProps {
  actions: MessagePanelToolbarAction[];
  gap?: number;
  suffix?: ReactNode;
}

const OVERFLOW_TRIGGER_WIDTH = 32;

function getPriority(key: MessagePanelToolbarActionKey) {
  if (key === 'open') return 0;
  return MESSAGE_TOOLBAR_ORDER.indexOf(key);
}

function getOverflowItemColors(tone: MessageToolbarActionTone | undefined) {
  const styles = getMessageToolbarToneColors(tone ?? 'default');
  return { iconColor: styles.iconColor, textColor: styles.textColor };
}

export function MessagePanelToolbar({ actions, gap = 8, suffix }: MessagePanelToolbarProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [widths, setWidths] = useState<Partial<Record<MessagePanelToolbarActionKey, number>>>({});
  const [suffixWidth, setSuffixWidth] = useState(0);

  const orderedActions = useMemo(
    () => actions.filter((action) => !action.hidden).sort((a, b) => getPriority(a.key) - getPriority(b.key)),
    [actions],
  );

  const allWidthsMeasured = orderedActions.every((action) => {
    const width = widths[action.key];
    return typeof width === 'number' && width > 0;
  });
  const hasSuffix = suffix != null;
  const actionContainerWidth = Math.max(0, containerWidth - (hasSuffix ? suffixWidth + gap : 0));

  const { visibleKeys, overflowKeys } = useMemo(() => {
    if (!allWidthsMeasured || actionContainerWidth <= 0) {
      return {
        visibleKeys: orderedActions.map((action) => action.key),
        overflowKeys: [] as MessagePanelToolbarActionKey[],
      };
    }

    return computeToolbarOverflowSplit(
      orderedActions.map((action) => ({
        key: action.key,
        priority: getPriority(action.key),
        width: widths[action.key] ?? 0,
      })),
      actionContainerWidth,
      { gap, overflowTriggerWidth: OVERFLOW_TRIGGER_WIDTH },
    ) as { visibleKeys: MessagePanelToolbarActionKey[]; overflowKeys: MessagePanelToolbarActionKey[] };
  }, [actionContainerWidth, allWidthsMeasured, gap, orderedActions, widths]);

  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const actionMap = useMemo(
    () => Object.fromEntries(orderedActions.map((action) => [action.key, action])) as Record<MessagePanelToolbarActionKey, MessagePanelToolbarAction>,
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
          icon: action.icon,
          onPress: action.onPress,
          tone: action.tone === 'destructive' ? 'destructive' : 'default',
          iconColor,
          textColor,
          accessibilityLabel: action.accessibilityLabel,
        };
      }),
    [actionMap, overflowKeys],
  );

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
  };

  const handleMeasure = (key: MessagePanelToolbarActionKey) => (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    if (nextWidth <= 0) return;
    setWidths((current) => (current[key] === nextWidth ? current : { ...current, [key]: nextWidth }));
  };

  const handleSuffixLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    setSuffixWidth((current) => (current === nextWidth ? current : nextWidth));
  };

  if (orderedActions.length === 0 && !hasSuffix) {
    return null;
  }

  return (
    <View className="flex-1 min-w-0 relative" onLayout={handleContainerLayout}>
      <View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        style={{
          position: 'absolute',
          opacity: 0,
          left: 0,
          top: 0,
          zIndex: -1,
        }}
        className="flex-row items-center gap-2"
      >
        {orderedActions.map((action) => (
          <View key={`measure-${action.key}`} onLayout={handleMeasure(action.key)} accessible={false}>
            {action.renderInline(true)}
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-2 min-w-0">
        {orderedActions.map((action) => (visibleSet.has(action.key) ? <View key={action.key}>{action.renderInline(false)}</View> : null))}
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
    </View>
  );
}
