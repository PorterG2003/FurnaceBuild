import { useMemo } from 'react';
import { View, Text, Pressable, Image, Platform } from 'react-native';
import { CalendarDaysIcon, ChevronDownIcon, NoSymbolIcon } from 'react-native-heroicons/outline';
import { Select } from '@/components/ui/forms';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { THREAD_CATEGORIES } from './inboxConstants';

const SMARTLEAD_BADGE_SOURCE =
  Platform.OS === 'web'
    ? { uri: '/smartlead_logo.png' }
    : require('../../public/smartlead_logo.png');

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
  showBlockButton = true,
  showOutOfOfficeButton = true,
  showReplaceLeadButton = true,
  threadTags = [],
  onOpenTagsPanel,
  category,
  onSetCategory,
  categoryOptions = [...THREAD_CATEGORIES],
  showToolbar = true,
  showTitleAndEmail = true,
  replacementSummary = null,
}: {
  prospectName?: string | null;
  campaignName?: string | null;
  sourceLabel?: string | null;
  prospectEmails: string[];
  blockedEmails?: string[] | Set<string>;
  onBlock?: () => void;
  onMarkOutOfOffice?: () => void;
  onReplaceLead?: () => void;
  showBlockButton?: boolean;
  showOutOfOfficeButton?: boolean;
  showReplaceLeadButton?: boolean;
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
}) {
  const showTags = !!onOpenTagsPanel;
  const isSmartleadSource = !!sourceLabel && (sourceLabel === 'Smartlead' || sourceLabel.startsWith('Imported from Smartlead'));
  const categoryItems = useMemo(
    () => [{ id: '', name: 'No category' }, ...categoryOptions.map((c) => ({ id: c, name: c }))],
    [categoryOptions]
  );

  const title = prospectName ?? prospectEmails[0] ?? '—';
  const emailLine = prospectEmails.length > 0 ? prospectEmails.join(', ') : '';
  const replacementLine = replacementSummary
    ? replacementSummary.role === 'new'
      ? `Replaces ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'previous lead'}`
      : `Replaced by ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'new lead'}`
    : null;

  const hasLeftContent = showTitleAndEmail;
  const hasRightContent = showToolbar;
  if (!hasLeftContent && !hasRightContent) {
    return null;
  }

  return (
    <View
      className="px-5 py-3.5 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <View className="flex-row items-center justify-between gap-3">
        {/* Left: prospect name + email (optional) */}
        <View className="flex-1 min-w-0">
          {showTitleAndEmail ? (
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
              {emailLine ? (
                <Text
                  className="text-sm font-instrument text-gray-500 leading-tight"
                  numberOfLines={1}
                  style={{ marginTop: 2 }}
                >
                  {emailLine}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>

        {/* Right: toolbar — campaign chip, Block List, tags, category */}
        {showToolbar ? (
        <View className="flex-row items-center gap-2 flex-shrink-0">
          {sourceLabel ? (
            isSmartleadSource ? (
              <Image
                source={SMARTLEAD_BADGE_SOURCE}
                style={{ width: 20, height: 20, borderRadius: 6 }}
                resizeMode="cover"
                accessibilityLabel="Smartlead"
              />
            ) : (
              <View
                className="rounded-lg px-2 py-0.5 items-center justify-center"
                style={{ backgroundColor: 'rgba(243, 68, 13, 0.12)', borderWidth: 1, borderColor: 'rgba(243, 68, 13, 0.3)' }}
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
          {showOutOfOfficeButton && onMarkOutOfOffice && (
            <Pressable
              onPress={onMarkOutOfOffice}
              className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-[32px]"
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                borderWidth: 1,
                borderColor: 'rgba(59, 130, 246, 0.45)',
              }}
            >
              <CalendarDaysIcon size={14} color="#93C5FD" />
              <Text className="text-xs font-instrument-medium" style={{ color: '#BFDBFE' }}>
                Out of office
              </Text>
            </Pressable>
          )}
          {showReplaceLeadButton && onReplaceLead && (
            <Pressable
              onPress={onReplaceLead}
              className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-[32px]"
              style={{
                backgroundColor: 'rgba(249, 115, 22, 0.12)',
                borderWidth: 1,
                borderColor: 'rgba(249, 115, 22, 0.4)',
              }}
            >
              <Text className="text-xs font-instrument-medium" style={{ color: '#FDBA74' }}>
                Replace lead
              </Text>
            </Pressable>
          )}
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
        ) : null}
      </View>
    </View>
  );
}
