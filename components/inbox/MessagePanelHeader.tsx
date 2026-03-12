import { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ChevronDownIcon, NoSymbolIcon } from 'react-native-heroicons/outline';
import { Select } from '@/components/ui/forms';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

/** Sticky header: left = prospect name + email; right = toolbar (campaign chip, Block, tags, category) */
export function MessagePanelHeader({
  prospectName,
  campaignName,
  sourceLabel,
  prospectEmails,
  blockedEmails = [],
  onBlock,
  showBlockButton = true,
  threadTags = [],
  onOpenTagsPanel,
  category,
  onSetCategory,
  categoryOptions = ['Interested', 'Not Interested'],
}: {
  prospectName?: string | null;
  campaignName?: string | null;
  sourceLabel?: string | null;
  prospectEmails: string[];
  blockedEmails?: string[] | Set<string>;
  onBlock?: () => void;
  showBlockButton?: boolean;
  threadTags?: ThreadTag[];
  /** When set, shows a single "Tags" control that opens the tags panel (add/remove/create). */
  onOpenTagsPanel?: () => void;
  category?: string | null;
  onSetCategory?: (category: string | null) => void;
  categoryOptions?: string[];
}) {
  const blockedSet = blockedEmails instanceof Set ? blockedEmails : new Set(blockedEmails);
  const hasBlocked = prospectEmails.some((e) => blockedSet.has(e.trim().toLowerCase()));
  const showTags = !!onOpenTagsPanel;
  const categoryItems = useMemo(
    () => [{ id: '', name: 'No category' }, ...categoryOptions.map((c) => ({ id: c, name: c }))],
    [categoryOptions]
  );

  const title = prospectName ?? prospectEmails[0] ?? '—';
  const emailLine = prospectEmails.length > 0 ? prospectEmails.join(', ') : '';

  return (
    <View
      className="px-5 py-3.5 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <View className="flex-row items-center justify-between gap-3">
        {/* Left: prospect name + email (tight between, more above/below) */}
        <View className="flex-1 min-w-0">
          <Text
            className="text-lg font-instrument-semibold text-white leading-tight"
            numberOfLines={1}
          >
            {title}
          </Text>
          {emailLine ? (
            <Text
              className="text-sm font-instrument text-gray-500 leading-tight"
              numberOfLines={1}
              style={{ marginTop: 2 }}
            >
              {emailLine}
            </Text>
          ) : null}
          {hasBlocked && (
            <Text className="text-gray-500 font-instrument text-xs mt-1.5">
              No automated emails to blocked.
            </Text>
          )}
        </View>

        {/* Right: toolbar — campaign chip, Block List, tags, category */}
        <View className="flex-row items-center gap-2 flex-shrink-0">
          {sourceLabel ? (
            <View
              className="rounded-lg px-2 py-0.5"
              style={
                sourceLabel === 'Smartlead' || sourceLabel.startsWith('Imported from Smartlead')
                  ? { backgroundColor: 'rgba(110, 88, 241, 0.12)', borderWidth: 1, borderColor: 'rgba(110, 88, 241, 0.3)' }
                  : { backgroundColor: 'rgba(243, 68, 13, 0.12)', borderWidth: 1, borderColor: 'rgba(243, 68, 13, 0.3)' }
              }
            >
              <Text
                className="text-xs font-instrument"
                style={{ color: sourceLabel === 'Smartlead' || sourceLabel.startsWith('Imported from Smartlead') ? '#6e58f1' : '#F97316' }}
                numberOfLines={1}
              >
                {sourceLabel}
              </Text>
            </View>
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
          {showBlockButton && onBlock && (
            <Pressable
              onPress={onBlock}
              className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-[32px]"
              style={{
                backgroundColor: 'rgba(185, 28, 28, 0.15)',
                borderWidth: 1,
                borderColor: 'rgba(185, 28, 28, 0.5)',
              }}
            >
              <NoSymbolIcon size={14} color="#F87171" />
              <Text
                className="text-xs font-instrument-medium"
                style={{ color: '#FCA5A5' }}
              >
                Block List
              </Text>
            </Pressable>
          )}
          {showTags && (
            <Pressable
              onPress={onOpenTagsPanel}
              className="flex-row items-center justify-between rounded-lg px-2.5 py-1.5 min-h-[32px] min-w-[80px]"
              style={{
                backgroundColor: '#FFFFFF0D',
                borderColor: '#FFFFFF4D',
                borderWidth: 1,
              }}
            >
              <Text
                className="text-xs font-instrument flex-1"
                style={{
                  color: threadTags.length > 0 ? '#FFFFFF' : '#666666',
                }}
              >
                Tags{threadTags.length > 0 ? ` (${threadTags.length})` : ''}
              </Text>
              <ChevronDownIcon size={14} color="#9CA3AF" style={{ marginLeft: 10 }} />
            </Pressable>
          )}
          {onSetCategory && categoryOptions.length > 0 && (
            <Select<{ id: string; name: string }>
              items={categoryItems}
              getItemId={(i) => i.id}
              getItemLabel={(i) => ({ primary: i.name })}
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
          )}
        </View>
      </View>
    </View>
  );
}
