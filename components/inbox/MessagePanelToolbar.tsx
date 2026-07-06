import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import {
  getInboxThreadToolbarPriority,
  type InboxThreadToolbarAction,
  type InboxThreadToolbarActionKey,
} from '@/lib/inbox';
import { useOnboardingOptional, useOnboardingTarget } from '@/components/onboarding';
import { TARGETS } from '@/lib/onboarding/types';
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

function getInboxOverflowTriggerActionKey(targetId: string | null): InboxThreadToolbarActionKey | null {
  switch (targetId) {
    case TARGETS.inboxActionCloseOverflowTrigger:
      return 'close';
    case TARGETS.inboxActionBlockOverflowTrigger:
      return 'block';
    case TARGETS.inboxActionOutOfOfficeOverflowTrigger:
      return 'ooo';
    case TARGETS.inboxActionReplaceOverflowTrigger:
      return 'replace';
    case TARGETS.inboxActionTagsOverflowTrigger:
      return 'tags';
    default:
      return null;
  }
}

function getInboxActionTargetActionKey(targetId: string | null): InboxThreadToolbarActionKey | null {
  switch (targetId) {
    case TARGETS.inboxActionClose:
      return 'close';
    case TARGETS.inboxActionBlock:
      return 'block';
    case TARGETS.inboxActionOutOfOffice:
      return 'ooo';
    case TARGETS.inboxActionReplace:
      return 'replace';
    case TARGETS.inboxActionTags:
      return 'tags';
    default:
      return null;
  }
}

function getOverflowItemColors(tone: InboxThreadToolbarAction['tone']) {
  const styles = getMessageToolbarToneColors(tone ?? 'default');
  return { iconColor: styles.iconColor, textColor: styles.textColor };
}

export function MessagePanelToolbar({ actions, gap = 8, prefix, suffix }: MessagePanelToolbarProps) {
  const onboarding = useOnboardingOptional();
  const closeActionRef = useOnboardingTarget(TARGETS.inboxActionClose);
  const blockActionRef = useOnboardingTarget(TARGETS.inboxActionBlock);
  const outOfOfficeActionRef = useOnboardingTarget(TARGETS.inboxActionOutOfOffice);
  const replaceActionRef = useOnboardingTarget(TARGETS.inboxActionReplace);
  const tagsActionRef = useOnboardingTarget(TARGETS.inboxActionTags);
  const closeOverflowTriggerRef = useOnboardingTarget(TARGETS.inboxActionCloseOverflowTrigger);
  const blockOverflowTriggerRef = useOnboardingTarget(TARGETS.inboxActionBlockOverflowTrigger);
  const outOfOfficeOverflowTriggerRef = useOnboardingTarget(TARGETS.inboxActionOutOfOfficeOverflowTrigger);
  const replaceOverflowTriggerRef = useOnboardingTarget(TARGETS.inboxActionReplaceOverflowTrigger);
  const tagsOverflowTriggerRef = useOnboardingTarget(TARGETS.inboxActionTagsOverflowTrigger);
  /** Full flex allocation for this toolbar (actions + suffix). */
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const [prefixWidth, setPrefixWidth] = useState(0);
  const [suffixWidth, setSuffixWidth] = useState(0);
  const overflowTriggerActionKey =
    onboarding?.currentStep?.kind === 'spotlight'
      ? getInboxOverflowTriggerActionKey(onboarding.currentStep.targetId)
      : null;
  const actionTargetRefs = useMemo<Partial<Record<InboxThreadToolbarActionKey, typeof closeActionRef>>>(
    () => ({
      close: closeActionRef,
      block: blockActionRef,
      ooo: outOfOfficeActionRef,
      replace: replaceActionRef,
      tags: tagsActionRef,
    }),
    [blockActionRef, closeActionRef, outOfOfficeActionRef, replaceActionRef, tagsActionRef],
  );
  const overflowTriggerTargetRefs = useMemo<Partial<Record<InboxThreadToolbarActionKey, typeof closeOverflowTriggerRef>>>(
    () => ({
      close: closeOverflowTriggerRef,
      block: blockOverflowTriggerRef,
      ooo: outOfOfficeOverflowTriggerRef,
      replace: replaceOverflowTriggerRef,
      tags: tagsOverflowTriggerRef,
    }),
    [
      blockOverflowTriggerRef,
      closeOverflowTriggerRef,
      outOfOfficeOverflowTriggerRef,
      replaceOverflowTriggerRef,
      tagsOverflowTriggerRef,
    ],
  );

  const orderedActions = useMemo(
    () => [...actions].sort((a, b) => getInboxThreadToolbarPriority(a.key) - getInboxThreadToolbarPriority(b.key)),
    [actions],
  );

  const hasPrefix = prefix != null;
  const hasSuffix = suffix != null;
  const prefixReserve = hasPrefix ? prefixWidth + (orderedActions.length > 0 ? gap : 0) : 0;
  const suffixReserve = hasSuffix ? suffixWidth + (orderedActions.length > 0 || hasPrefix ? gap : 0) : 0;
  const actionBudget = Math.max(0, toolbarWidth - prefixReserve - suffixReserve);

  const normalSplit = useMemo(() => {
    if (orderedActions.length === 0) {
      return {
        visibleKeys: [] as InboxThreadToolbarActionKey[],
        overflowKeys: [] as InboxThreadToolbarActionKey[],
      };
    }

    if (actionBudget <= 0) {
      return {
        visibleKeys: [] as InboxThreadToolbarActionKey[],
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
    }) as { visibleKeys: InboxThreadToolbarActionKey[]; overflowKeys: InboxThreadToolbarActionKey[] };
  }, [actionBudget, gap, orderedActions]);

  const visibleKeys = normalSplit.visibleKeys;
  const overflowKeys = normalSplit.overflowKeys;

  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const actionMap = useMemo(
    () => Object.fromEntries(orderedActions.map((action) => [action.key, action])) as Record<InboxThreadToolbarActionKey, InboxThreadToolbarAction>,
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
          targetRef: actionTargetRefs[action.key],
          tone: action.tone === 'destructive' ? 'destructive' : 'default',
          iconColor,
          textColor,
          accessibilityLabel: action.accessibilityLabel,
        };
      }),
    [actionMap, actionTargetRefs, overflowKeys],
  );
  const activeOverflowTriggerRef =
    overflowTriggerActionKey && overflowKeys.includes(overflowTriggerActionKey)
      ? overflowTriggerTargetRefs[overflowTriggerActionKey]
      : undefined;

  // Report the current overflow split to onboarding so the inbox action tours
  // can resolve inline-vs-in-menu steps up front. Only report once the toolbar
  // has actually measured (toolbarWidth > 0); before that the split collapses
  // everything into overflow and would resolve the tour against a phantom
  // layout. Clear when this toolbar unmounts (thread closed / pane torn down).
  const reportInboxToolbarOverflow = onboarding?.setInboxToolbarOverflow;
  const toolbarMeasured = toolbarWidth > 0;
  useEffect(() => {
    if (!reportInboxToolbarOverflow) return;
    reportInboxToolbarOverflow(toolbarMeasured ? overflowKeys : null);
  }, [actionBudget, orderedActions, overflowKeys, reportInboxToolbarOverflow, toolbarMeasured, toolbarWidth]);
  useEffect(() => {
    if (!reportInboxToolbarOverflow) return;
    return () => reportInboxToolbarOverflow(null);
  }, [reportInboxToolbarOverflow]);

  // While the tour is highlighting the overflow trigger or a collapsed action,
  // pin the menu open so it does not close when the user clicks the callout.
  const currentStepTargetId =
    onboarding?.currentStep?.kind === 'spotlight' ? onboarding.currentStep.targetId : null;
  const pinnedActionKey =
    overflowTriggerActionKey ?? getInboxActionTargetActionKey(currentStepTargetId);
  const overflowMenuPinned = pinnedActionKey != null && overflowKeys.includes(pinnedActionKey);

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
                targetRef={actionTargetRefs[action.key]}
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
        <View
          ref={activeOverflowTriggerRef}
          collapsable={false}
          className="shrink-0"
        >
          <RowOverflowMenu
            items={overflowItems}
            horizontalAlign="end"
            menuMinWidth={180}
            triggerAccessibilityLabel="More message actions"
            triggerContainerClassName="self-start"
            triggerVariant="mobile-actions"
            forceOpen={overflowMenuPinned}
          />
        </View>
      ) : null}
    </View>
  );
}
