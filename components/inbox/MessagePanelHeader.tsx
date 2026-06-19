import { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SmartleadBadge } from '@/components/campaigns';
import { ArrowPathIcon, CalendarDaysIcon, CheckCircleIcon, NoSymbolIcon, TagIcon } from 'react-native-heroicons/outline';
import { Select } from '@/components/ui/forms';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import {
  THREAD_CATEGORIES,
} from './inboxConstants';
import { MessagePanelToolbar, type MessagePanelToolbarAction } from './MessagePanelToolbar';
import { MessageToolbarActionButton } from './MessageToolbarActionButton';

/** Sticky header: left = prospect name + email; right = toolbar (campaign chip, Block, tags, category) */
export function MessagePanelHeader({
  prospectName,
  campaignName,
  sourceLabel,
  prospectEmails,
  blockedEmails: _blockedEmails = [],
  onBlock,
  onMarkOutOfOffice,
  onReplaceLead,
  onCloseConversation,
  onOpenConversation,
  showBlockButton = true,
  showOutOfOfficeButton = true,
  showReplaceLeadButton = true,
  showCloseConversationButton = true,
  showOpenConversationButton = false,
  threadTags = [],
  onOpenTagsPanel,
  category,
  onSetCategory,
  categoryOptions = [...THREAD_CATEGORIES],
  showToolbar = true,
  showTitleAndEmail = true,
  replacementSummary = null,
  onOpenLeadDetail,
}: {
  prospectName?: string | null;
  campaignName?: string | null;
  sourceLabel?: string | null;
  prospectEmails: string[];
  blockedEmails?: string[] | Set<string>;
  onBlock?: () => void;
  onMarkOutOfOffice?: () => void;
  onReplaceLead?: () => void;
  onCloseConversation?: () => void;
  onOpenConversation?: () => void;
  showBlockButton?: boolean;
  showOutOfOfficeButton?: boolean;
  showReplaceLeadButton?: boolean;
  showCloseConversationButton?: boolean;
  showOpenConversationButton?: boolean;
  threadTags?: ThreadTag[];
  /** When set, shows a single "Tags" control that opens the tags panel (add/remove/create). */
  onOpenTagsPanel?: () => void;
  category?: string | null;
  onSetCategory?: (category: string | null) => void;
  categoryOptions?: string[];
  /** When false, hide the right-side toolbar (Block, Tags, Category). Default true. */
  showToolbar?: boolean;
  /** When false, hide the left-side title and email (e.g. when shown in a parent header). Default true. */
  showTitleAndEmail?: boolean;
  replacementSummary?: LeadReplacementSummary | null;
  /** Opens the account lead detail page for this prospect. */
  onOpenLeadDetail?: () => void;
}) {
  const showTags = !!onOpenTagsPanel;
  const isSmartleadSource = !!sourceLabel && (sourceLabel === 'Smartlead' || sourceLabel.startsWith('Imported from Smartlead'));
  const categoryItems = useMemo(
    () => [{ id: '', name: 'No category' }, ...categoryOptions.map((c) => ({ id: c, name: c }))],
    [categoryOptions]
  );
  const tagLabel = threadTags.length > 0 ? `Tags (${threadTags.length})` : 'Tags';

  const title = prospectName ?? prospectEmails[0] ?? '—';
  const replacementLine = replacementSummary
    ? replacementSummary.role === 'new'
      ? `Replaces ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'previous lead'}`
      : `Replaced by ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'new lead'}`
    : null;

  const hasLeftContent = showTitleAndEmail;
  const hasRightContent = showToolbar;

  const titleContent = (
    <>
      <View className="flex-row items-center gap-2 min-w-0">
        <Text
          className="text-lg font-instrument-semibold text-white leading-tight"
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {title}
        </Text>
        {replacementLine ? (
          <View
            className="rounded-lg px-2 py-0.5 flex-shrink-0"
            style={{
              backgroundColor: 'rgba(249, 115, 22, 0.12)',
              borderWidth: 1,
              borderColor: 'rgba(249, 115, 22, 0.35)',
            }}
          >
            <Text
              className="text-xs font-instrument-medium"
              style={{ color: '#FDBA74' }}
              numberOfLines={1}
            >
              {replacementLine}
            </Text>
          </View>
        ) : null}
      </View>
      {prospectEmails.length > 0 ? (
        <View className="gap-0.5" style={{ marginTop: 2 }}>
          {prospectEmails.map((email, index) => (
            <Text
              key={`${email}-${index}`}
              className="text-sm font-instrument text-gray-500 leading-tight"
              numberOfLines={1}
            >
              {email}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );

  const toolbarActions = useMemo<MessagePanelToolbarAction[]>(
    () => [
      ...(showCloseConversationButton && onCloseConversation
        ? [
            {
              key: 'close' as const,
              label: 'Close conversation',
              icon: CheckCircleIcon,
              onPress: onCloseConversation,
              tone: 'open' as const,
              renderInline: (measureOnly = false) => (
                <MessageToolbarActionButton
                  label="Close conversation"
                  icon={CheckCircleIcon}
                  onPress={onCloseConversation}
                  tone="open"
                  measureOnly={measureOnly}
                />
              ),
            },
          ]
        : []),
      ...(showOpenConversationButton && onOpenConversation
        ? [
            {
              key: 'open' as const,
              label: 'Open conversation',
              icon: CheckCircleIcon,
              onPress: onOpenConversation,
              tone: 'open' as const,
              renderInline: (measureOnly = false) => (
                <MessageToolbarActionButton
                  label="Open conversation"
                  icon={CheckCircleIcon}
                  onPress={onOpenConversation}
                  tone="open"
                  measureOnly={measureOnly}
                />
              ),
            },
          ]
        : []),
      ...(showBlockButton && onBlock
        ? [
            {
              key: 'block' as const,
              label: 'Block List',
              icon: NoSymbolIcon,
              onPress: onBlock,
              tone: 'destructive' as const,
              renderInline: (measureOnly = false) => (
                <MessageToolbarActionButton
                  label="Block List"
                  icon={NoSymbolIcon}
                  onPress={onBlock}
                  tone="destructive"
                  measureOnly={measureOnly}
                />
              ),
            },
          ]
        : []),
      ...(showOutOfOfficeButton && onMarkOutOfOffice
        ? [
            {
              key: 'ooo' as const,
              label: 'Out of office',
              icon: CalendarDaysIcon,
              onPress: onMarkOutOfOffice,
              tone: 'ooo' as const,
              renderInline: (measureOnly = false) => (
                <MessageToolbarActionButton
                  label="Out of office"
                  icon={CalendarDaysIcon}
                  onPress={onMarkOutOfOffice}
                  tone="ooo"
                  measureOnly={measureOnly}
                />
              ),
            },
          ]
        : []),
      ...(showReplaceLeadButton && onReplaceLead
        ? [
            {
              key: 'replace' as const,
              label: 'Replace + forward',
              icon: ArrowPathIcon,
              onPress: onReplaceLead,
              tone: 'replace' as const,
              renderInline: (measureOnly = false) => (
                <MessageToolbarActionButton
                  label="Replace + forward"
                  icon={ArrowPathIcon}
                  onPress={onReplaceLead}
                  tone="replace"
                  measureOnly={measureOnly}
                />
              ),
            },
          ]
        : []),
      ...(showTags
        ? [
            {
              key: 'tags' as const,
              label: tagLabel,
              icon: TagIcon,
              onPress: onOpenTagsPanel,
              tone: 'default' as const,
              accessibilityLabel: 'Open tags panel',
              renderInline: (measureOnly = false) => (
                <MessageToolbarActionButton
                  label={tagLabel}
                  onPress={onOpenTagsPanel}
                  tone="default"
                  trailingChevron
                  compactLabelColor={threadTags.length > 0 ? '#FFFFFF' : '#666666'}
                  accessibilityLabel="Open tags panel"
                  measureOnly={measureOnly}
                />
              ),
            },
          ]
        : []),
    ],
    [
      onBlock,
      onCloseConversation,
      onOpenConversation,
      onMarkOutOfOffice,
      onOpenTagsPanel,
      onReplaceLead,
      showBlockButton,
      showCloseConversationButton,
      showOpenConversationButton,
      showOutOfOfficeButton,
      showReplaceLeadButton,
      showTags,
      tagLabel,
      threadTags.length,
    ],
  );

  if (!hasLeftContent && !hasRightContent) {
    return null;
  }

  return (
    <View
      className="px-5 py-3.5 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <View className="flex-row items-start gap-3">
        {/* Left: prospect name + email (optional) */}
        <View className="flex-1 min-w-0" style={{ flexBasis: 0 }}>
          {showTitleAndEmail ? (
            onOpenLeadDetail ? (
              <Pressable onPress={onOpenLeadDetail} accessibilityLabel="View lead profile">
                {titleContent}
              </Pressable>
            ) : (
              titleContent
            )
          ) : null}
        </View>

        {/* Right: toolbar — campaign chip, Block List, tags, category */}
        {showToolbar ? (
          <View className="flex-row items-center gap-2 min-w-0" style={{ flexShrink: 1, maxWidth: '55%' }}>
            {(sourceLabel || campaignName) && (
              <View className="flex-row items-center gap-2 shrink-0">
                {sourceLabel ? (
                  isSmartleadSource ? (
                    <SmartleadBadge />
                  ) : (
                    <View
                      className="rounded-lg px-2 py-0.5 items-center justify-center"
                      style={{
                        backgroundColor: 'rgba(243, 68, 13, 0.12)',
                        borderWidth: 1,
                        borderColor: 'rgba(243, 68, 13, 0.3)',
                      }}
                    >
                      <Text
                        className="text-xs font-instrument"
                        style={{ color: '#F97316' }}
                        numberOfLines={1}
                      >
                        {sourceLabel}
                      </Text>
                    </View>
                  )
                ) : null}
                {campaignName ? (
                  <View
                    className="rounded-lg px-2 py-0.5"
                    style={{ backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#3A3A3A' }}
                  >
                    <Text className="text-xs font-instrument text-gray-400" numberOfLines={1}>
                      {campaignName}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            <MessagePanelToolbar
              actions={toolbarActions}
              suffix={
                onSetCategory && categoryOptions.length > 0 ? (
                  <Select<{ id: string; name: string }>
                    items={categoryItems}
                    getItemId={(i) => i.id}
                    getItemLabel={(i) => ({
                      primary: i.name,
                      // Auto Reply releases a held outbound sequence in categorizer flows.
                      secondary: i.id === 'Auto Reply' ? 'Not a real reply — sequence continues' : undefined,
                    })}
                    getItemColor={(item) => getCategoryColor(item.id || null)}
                    itemColorVariant="tint"
                    value={category ?? ''}
                    onChange={(id) => onSetCategory(id || null)}
                    placeholder="Category"
                    searchable={false}
                    noMargin
                    size="compact"
                    dropdownMinWidth={220}
                    listMaxHeight={220}
                  />
                ) : null
              }
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
