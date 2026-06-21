export const INBOX_THREAD_TOOLBAR_ORDER = ['close', 'open', 'block', 'ooo', 'replace', 'tags'] as const;

export type InboxThreadToolbarActionKey = (typeof INBOX_THREAD_TOOLBAR_ORDER)[number];
export type InboxThreadToolbarActionTone = 'default' | 'destructive' | 'open' | 'ooo' | 'replace';
export type InboxThreadToolbarIconKey = 'checkCircle' | 'noSymbol' | 'calendarDays' | 'arrowPath' | 'tag';

export interface InboxThreadToolbarAction {
  key: InboxThreadToolbarActionKey;
  label: string;
  iconKey: InboxThreadToolbarIconKey;
  onPress: () => void;
  tone?: InboxThreadToolbarActionTone;
  accessibilityLabel?: string;
  trailingChevron?: boolean;
  compactLabelColor?: string;
}

export interface BuildInboxThreadToolbarActionsOptions {
  showBlockButton?: boolean;
  onBlock?: () => void;
  showOutOfOfficeButton?: boolean;
  onMarkOutOfOffice?: () => void;
  showReplaceLeadButton?: boolean;
  onReplaceLead?: () => void;
  showCloseConversationButton?: boolean;
  onCloseConversation?: () => void;
  showOpenConversationButton?: boolean;
  onOpenConversation?: () => void;
  onOpenTagsPanel?: () => void;
  tagCount?: number;
}

export function getInboxThreadToolbarPriority(key: InboxThreadToolbarActionKey) {
  if (key === 'open') return 0;
  return INBOX_THREAD_TOOLBAR_ORDER.indexOf(key);
}

export function buildInboxThreadToolbarActions({
  showBlockButton = true,
  onBlock,
  showOutOfOfficeButton = true,
  onMarkOutOfOffice,
  showReplaceLeadButton = true,
  onReplaceLead,
  showCloseConversationButton = true,
  onCloseConversation,
  showOpenConversationButton = false,
  onOpenConversation,
  onOpenTagsPanel,
  tagCount = 0,
}: BuildInboxThreadToolbarActionsOptions): InboxThreadToolbarAction[] {
  const actions: InboxThreadToolbarAction[] = [];

  if (showCloseConversationButton && onCloseConversation) {
    actions.push({
      key: 'close',
      label: 'Close conversation',
      iconKey: 'checkCircle',
      onPress: onCloseConversation,
      tone: 'open',
    });
  }

  if (showOpenConversationButton && onOpenConversation) {
    actions.push({
      key: 'open',
      label: 'Open conversation',
      iconKey: 'checkCircle',
      onPress: onOpenConversation,
      tone: 'open',
    });
  }

  if (showBlockButton && onBlock) {
    actions.push({
      key: 'block',
      label: 'Block List',
      iconKey: 'noSymbol',
      onPress: onBlock,
      tone: 'destructive',
    });
  }

  if (showOutOfOfficeButton && onMarkOutOfOffice) {
    actions.push({
      key: 'ooo',
      label: 'Out of office',
      iconKey: 'calendarDays',
      onPress: onMarkOutOfOffice,
      tone: 'ooo',
    });
  }

  if (showReplaceLeadButton && onReplaceLead) {
    actions.push({
      key: 'replace',
      label: 'Replace + forward',
      iconKey: 'arrowPath',
      onPress: onReplaceLead,
      tone: 'replace',
    });
  }

  if (onOpenTagsPanel) {
    actions.push({
      key: 'tags',
      label: tagCount > 0 ? `Tags (${tagCount})` : 'Tags',
      iconKey: 'tag',
      onPress: onOpenTagsPanel,
      accessibilityLabel: 'Open tags panel',
      trailingChevron: true,
      compactLabelColor: tagCount > 0 ? '#FFFFFF' : '#666666',
    });
  }

  return actions.sort((a, b) => getInboxThreadToolbarPriority(a.key) - getInboxThreadToolbarPriority(b.key));
}
