import React, { useState, useMemo } from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { Select, SearchAndSelectMulti } from '@/components/ui/forms';
import { Toggle } from '@/components/ui/Toggle';
import type { Mailbox, Campaign } from '@/lib/supabase/types';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import { resolveTagColor } from '@/lib/inbox/tag-colors';
import { NO_CATEGORY_FILTER } from '@/lib/supabase/services/inbox';

const THREAD_CATEGORIES = ['Interested', 'Not Interested'];
const DATE_OPTIONS = [
  { id: 'all', name: 'All' },
  { id: '7d', name: 'Last 7 days' },
  { id: '30d', name: 'Last 30 days' },
];

export interface InboxFilterDropdownProps {
  visible: boolean;
  onClose: () => void;
  anchorLayout: { x: number; y: number; w: number; h: number } | null;
  unreadOnlyFilter: boolean;
  onUnreadOnlyFilterChange: (v: boolean) => void;
  datePreset: '7d' | '30d' | null;
  onDatePresetChange: (v: '7d' | '30d' | null) => void;
  mailboxFilterId: string | null;
  onMailboxFilterIdChange: (id: string | null) => void;
  campaignFilterId: string | null;
  onCampaignFilterIdChange: (id: string | null) => void;
  categoryFilter: string | null;
  onCategoryFilterChange: (v: string | null) => void;
  tagFilterIds: string[];
  onTagFilterIdsChange: (ids: string[]) => void;
  mailboxes: Mailbox[];
  campaigns: Campaign[];
  accountTags: ThreadTag[];
  onClearAll: () => void;
}

export function InboxFilterDropdown({
  visible,
  onClose,
  anchorLayout,
  unreadOnlyFilter,
  onUnreadOnlyFilterChange,
  datePreset,
  onDatePresetChange,
  mailboxFilterId,
  onMailboxFilterIdChange,
  campaignFilterId,
  onCampaignFilterIdChange,
  categoryFilter,
  onCategoryFilterChange,
  tagFilterIds,
  onTagFilterIdsChange,
  mailboxes,
  campaigns,
  accountTags,
  onClearAll,
}: InboxFilterDropdownProps) {
  const [dateSearch, setDateSearch] = useState('');
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [categorySearch, setCategorySearch] = useState('');

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
  const filteredDateItems = useMemo(() => {
    if (!dateSearch.trim()) return dateItems;
    const q = dateSearch.trim().toLowerCase();
    return dateItems.filter((i) => i.name.toLowerCase().includes(q));
  }, [dateItems, dateSearch]);
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
  const filteredCategoryItems = useMemo(() => {
    if (!categorySearch.trim()) return categoryItems;
    const q = categorySearch.trim().toLowerCase();
    return categoryItems.filter((i) => i.name.toLowerCase().includes(q));
  }, [categoryItems, categorySearch]);

  const dateValue = datePreset ?? 'all';

  if (!visible || !anchorLayout) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <Pressable
          style={{
            position: 'absolute',
            left: anchorLayout.x,
            top: anchorLayout.y + anchorLayout.h + 4,
            width: Math.max(anchorLayout.w, 440),
            maxHeight: 560,
            backgroundColor: '#1A1A1A',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#2A2A2A',
            ...(typeof window !== 'undefined'
              ? { boxShadow: '0px 8px 16px rgba(0,0,0,0.35)' }
              : { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 12 }),
            overflow: 'hidden',
          }}
          onPress={(e) => e?.stopPropagation?.()}
        >
          <ScrollView
            style={{ maxHeight: 560 }}
            contentContainerStyle={{ padding: 16 }}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {/* Unread */}
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-xs font-instrument-medium text-gray-400">Unread only</Text>
              <Toggle
                value={unreadOnlyFilter}
                onValueChange={onUnreadOnlyFilterChange}
              />
            </View>

            {/* Date */}
            <Select
              label="Date"
              items={filteredDateItems}
              getItemId={(i) => i.id}
              getItemLabel={(i) => ({ primary: i.name })}
              value={dateValue}
              onChange={(id) => onDatePresetChange(id === 'all' ? null : (id as '7d' | '30d'))}
              onSearchChange={setDateSearch}
              searchPlaceholder="Search…"
              placeholder="All"
              listMaxHeight={180}
            />

            {/* Mailbox */}
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
              listMaxHeight={200}
            />

            {/* Campaign */}
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
              listMaxHeight={200}
            />

            {/* Category */}
            <Select
              label="Category"
              items={filteredCategoryItems}
              getItemId={(i) => i.id}
              getItemLabel={(i) => ({ primary: i.name })}
              getItemColor={(item) => (item.id === 'all' || item.id === NO_CATEGORY_FILTER ? null : getCategoryColor(item.id))}
              itemColorVariant="tint"
              value={categoryFilter || 'all'}
              onChange={(id) => onCategoryFilterChange(id === 'all' ? null : id)}
              onSearchChange={setCategorySearch}
              searchPlaceholder="Search…"
              placeholder="All"
              listMaxHeight={180}
            />

            {/* Tag (multi-select) */}
            <SearchAndSelectMulti
              label="Tag"
              items={accountTags}
              getItemId={(t) => t.id}
              getItemLabel={(t) => t.name}
              getItemColor={(t) => resolveTagColor(t.color)}
              value={tagFilterIds}
              onChange={onTagFilterIdsChange}
              searchPlaceholder="Search tags…"
              placeholder="All"
              listMaxHeight={200}
              emptyMessage={(hasSearch) => (hasSearch ? 'No matching tags.' : 'No tags yet.')}
            />

            {/* Clear all */}
            <Pressable onPress={onClearAll} className="py-2 mt-2">
              <Text className="text-gray-400 font-instrument text-sm text-center">Clear all</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
