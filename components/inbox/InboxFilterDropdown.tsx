import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { BottomSheet } from '@/components/ui/modals';
import { Select, SearchAndSelectMulti } from '@/components/ui/forms';
import { Toggle } from '@/components/ui/Toggle';
import type { Mailbox, Campaign } from '@/lib/supabase/types';
import type { CampaignTag } from '@/lib/supabase/services/campaign-tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { NO_CATEGORY_FILTER, type InboxThreadSortBy } from '@/lib/supabase/services/inbox';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import { resolveTagColor } from '@/lib/tags/tag-colors';
import { THREAD_CATEGORIES } from './inboxConstants';

const DATE_OPTIONS = [
  { id: 'all', name: 'All' },
  { id: '7d', name: 'Last 7 days' },
  { id: '30d', name: 'Last 30 days' },
];

const CONVERSATION_STATUS_OPTIONS = [
  { id: 'all', name: 'All conversations' },
  { id: 'open', name: 'Open only' },
  { id: 'closed', name: 'Closed only' },
] as const;

const SORT_OPTIONS: { id: InboxThreadSortBy; name: string }[] = [
  { id: 'newest', name: 'Newest' },
  { id: 'open_first', name: 'Open first' },
  { id: 'oldest', name: 'Oldest' },
  { id: 'unread_first', name: 'Unread first' },
];

const DROPDOWN_SCROLL_MAX = 640;
const DROPDOWN_MIN_WIDTH = 520;
const SELECT_LIST_MAX = 150;

export interface InboxFilterDropdownProps {
  visible: boolean;
  onClose: () => void;
  presentation: 'dropdown' | 'sheet';
  /** Used when presentation is "sheet" */
  sheetMaxHeight: number;
  anchorLayout: { x: number; y: number; w: number; h: number } | null;
  unreadOnlyFilter: boolean;
  onUnreadOnlyFilterChange: (v: boolean) => void;
  sortBy: InboxThreadSortBy;
  onSortByChange: (v: InboxThreadSortBy) => void;
  datePreset: '7d' | '30d' | null;
  onDatePresetChange: (v: '7d' | '30d' | null) => void;
  mailboxFilterId: string | null;
  onMailboxFilterIdChange: (id: string | null) => void;
  campaignFilterId: string | null;
  onCampaignFilterIdChange: (id: string | null) => void;
  categoryFilter: string | null;
  onCategoryFilterChange: (v: string | null) => void;
  conversationStatusFilter: 'open' | 'closed' | 'all';
  onConversationStatusFilterChange: (v: 'open' | 'closed' | 'all') => void;
  tagFilterIds: string[];
  onTagFilterIdsChange: (ids: string[]) => void;
  campaignTagFilterIds: string[];
  onCampaignTagFilterIdsChange: (ids: string[]) => void;
  mailboxes: Mailbox[];
  campaigns: Campaign[];
  accountTags: ThreadTag[];
  accountCampaignTags: CampaignTag[];
  onClearAll: () => void;
}

export function InboxFilterDropdown({
  visible,
  onClose,
  presentation,
  sheetMaxHeight,
  anchorLayout,
  unreadOnlyFilter,
  onUnreadOnlyFilterChange,
  sortBy,
  onSortByChange,
  datePreset,
  onDatePresetChange,
  mailboxFilterId,
  onMailboxFilterIdChange,
  campaignFilterId,
  onCampaignFilterIdChange,
  categoryFilter,
  onCategoryFilterChange,
  conversationStatusFilter,
  onConversationStatusFilterChange,
  tagFilterIds,
  onTagFilterIdsChange,
  campaignTagFilterIds,
  onCampaignTagFilterIdsChange,
  mailboxes,
  campaigns,
  accountTags,
  accountCampaignTags,
  onClearAll,
}: InboxFilterDropdownProps) {
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');

  const useTwoColumn = presentation === 'dropdown';

  const mailboxItems = useMemo(
    () => [{ id: 'all', email_address: 'All' } as { id: string; email_address: string }, ...mailboxes],
    [mailboxes]
  );
  const campaignItems = useMemo(
    () => [{ id: 'all', name: 'All' } as { id: string; name: string }, ...campaigns],
    [campaigns]
  );
  const categoryItems = useMemo(
    () => [
      { id: 'all', name: 'All' },
      { id: NO_CATEGORY_FILTER, name: 'No category' },
      ...THREAD_CATEGORIES.map((c) => ({ id: c, name: c })),
    ],
    []
  );
  const dateItems = useMemo(() => DATE_OPTIONS, []);
  const conversationStatusItems = useMemo(() => [...CONVERSATION_STATUS_OPTIONS], []);
  const sortItems = useMemo(() => SORT_OPTIONS, []);
  const filteredMailboxItems = useMemo(() => {
    if (!mailboxSearch.trim()) return mailboxItems;
    const q = mailboxSearch.trim().toLowerCase();
    return mailboxItems.filter((m) => (m.email_address ?? '').toLowerCase().includes(q));
  }, [mailboxItems, mailboxSearch]);
  const filteredCampaignItems = useMemo(() => {
    if (!campaignSearch.trim()) return campaignItems;
    const q = campaignSearch.trim().toLowerCase();
    return campaignItems.filter((c) => (c.name ?? '').toLowerCase().includes(q));
  }, [campaignItems, campaignSearch]);

  const dateValue = datePreset ?? 'all';

  const scrollMaxHeight = presentation === 'sheet' ? sheetMaxHeight : DROPDOWN_SCROLL_MAX;

  const dateSelect = (
    <Select
      label="Date"
      items={dateItems}
      getItemId={(i) => i.id}
      getItemLabel={(i) => ({ primary: i.name })}
      value={dateValue}
      onChange={(id) => onDatePresetChange(id === 'all' ? null : (id as '7d' | '30d'))}
      searchable={false}
      placeholder="All"
      listMaxHeight={SELECT_LIST_MAX}
      noMargin={useTwoColumn}
    />
  );

  const conversationStatusSelect = (
    <Select
      label="Conversation status"
      items={conversationStatusItems}
      getItemId={(i) => i.id}
      getItemLabel={(i) => ({ primary: i.name })}
      value={conversationStatusFilter}
      onChange={(id) => onConversationStatusFilterChange(id as 'open' | 'closed' | 'all')}
      searchable={false}
      placeholder="All conversations"
      listMaxHeight={SELECT_LIST_MAX}
      noMargin={useTwoColumn}
    />
  );

  const mailboxSelect = (
    <Select
      label="Mailbox"
      items={filteredMailboxItems}
      getItemId={(m) => m.id}
      getItemLabel={(m) => ({ primary: m.email_address ?? 'All' })}
      value={mailboxFilterId || 'all'}
      onChange={(id) => onMailboxFilterIdChange(id === 'all' ? null : id)}
      onSearchChange={setMailboxSearch}
      searchPlaceholder="Search mailboxes…"
      placeholder="All"
      listMaxHeight={SELECT_LIST_MAX}
      noMargin={useTwoColumn}
    />
  );

  const campaignSelect = (
    <Select
      label="Campaign"
      items={filteredCampaignItems}
      getItemId={(c) => c.id}
      getItemLabel={(c) => ({ primary: c.name ?? 'All' })}
      value={campaignFilterId || 'all'}
      onChange={(id) => onCampaignFilterIdChange(id === 'all' ? null : id)}
      onSearchChange={setCampaignSearch}
      searchPlaceholder="Search campaigns…"
      placeholder="All"
      listMaxHeight={SELECT_LIST_MAX}
      noMargin={useTwoColumn}
    />
  );

  const filterFormScroll = (
    <ScrollView
      style={{ maxHeight: scrollMaxHeight }}
      contentContainerStyle={{ padding: 12 }}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-xs font-instrument-medium text-gray-400">Unread only</Text>
        <Toggle value={unreadOnlyFilter} onValueChange={onUnreadOnlyFilterChange} />
      </View>

      <Select
        label="Sort"
        items={sortItems}
        getItemId={(i) => i.id}
        getItemLabel={(i) => ({ primary: i.name })}
        value={sortBy}
        onChange={(id) => onSortByChange(id as InboxThreadSortBy)}
        searchable={false}
        placeholder="Newest"
        listMaxHeight={SELECT_LIST_MAX}
      />

      {useTwoColumn ? (
        <View className="flex-row gap-3 mb-3">
          <View className="flex-1">{dateSelect}</View>
          <View className="flex-1">{conversationStatusSelect}</View>
        </View>
      ) : (
        <>
          {dateSelect}
          {conversationStatusSelect}
        </>
      )}

      {useTwoColumn ? (
        <View className="flex-row gap-3 mb-3">
          <View className="flex-1">{mailboxSelect}</View>
          <View className="flex-1">{campaignSelect}</View>
        </View>
      ) : (
        <>
          {mailboxSelect}
          {campaignSelect}
        </>
      )}

      <Select
        label="Category"
        items={categoryItems}
        getItemId={(i) => i.id}
        getItemLabel={(i) => ({ primary: i.name })}
        getItemColor={(item) =>
          item.id === 'all' || item.id === NO_CATEGORY_FILTER ? null : getCategoryColor(item.id)
        }
        itemColorVariant="tint"
        value={categoryFilter || 'all'}
        onChange={(id) => onCategoryFilterChange(id === 'all' ? null : id)}
        searchable={false}
        placeholder="All"
        listMaxHeight={SELECT_LIST_MAX}
      />

      <SearchAndSelectMulti
        label="Thread tags"
        items={accountTags}
        getItemId={(t) => t.id}
        getItemLabel={(t) => t.name}
        getItemColor={(t) => resolveTagColor(t.color)}
        value={tagFilterIds}
        onChange={onTagFilterIdsChange}
        searchPlaceholder="Search thread tags…"
        placeholder="All thread tags"
        listMaxHeight={SELECT_LIST_MAX}
        emptyMessage={(hasSearch) => (hasSearch ? 'No matching thread tags.' : 'No thread tags yet.')}
      />

      <SearchAndSelectMulti
        label="Campaign tags"
        items={accountCampaignTags}
        getItemId={(t) => t.id}
        getItemLabel={(t) => t.name}
        getItemColor={(t) => resolveTagColor(t.color)}
        value={campaignTagFilterIds}
        onChange={onCampaignTagFilterIdsChange}
        searchPlaceholder="Search campaign tags…"
        placeholder="All campaign tags"
        listMaxHeight={SELECT_LIST_MAX}
        emptyMessage={(hasSearch) =>
          hasSearch ? 'No matching campaign tags.' : 'No campaign tags yet.'
        }
      />

      <Pressable onPress={onClearAll} className="py-2 mt-1">
        <Text className="text-gray-400 font-instrument text-sm text-center">Clear all</Text>
      </Pressable>
    </ScrollView>
  );

  if (presentation === 'sheet') {
    return (
      <BottomSheet visible={visible} onClose={onClose}>
        <View style={{ maxHeight: sheetMaxHeight }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            {filterFormScroll}
          </KeyboardAvoidingView>
        </View>
      </BottomSheet>
    );
  }

  if (!visible || !anchorLayout) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <Pressable
          style={{
            position: 'absolute',
            left: anchorLayout.x,
            top: anchorLayout.y + anchorLayout.h + 4,
            width: Math.max(anchorLayout.w, DROPDOWN_MIN_WIDTH),
            maxHeight: DROPDOWN_SCROLL_MAX,
            backgroundColor: '#1A1A1A',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#2A2A2A',
            ...(typeof window !== 'undefined'
              ? { boxShadow: '0px 8px 16px rgba(0,0,0,0.35)' }
              : {
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.35,
                  shadowRadius: 16,
                  elevation: 12,
                }),
            overflow: 'hidden',
          }}
          onPress={(e) => e?.stopPropagation?.()}
        >
          {filterFormScroll}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
