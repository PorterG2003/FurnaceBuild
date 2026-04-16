import React, { type RefObject } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, RefreshControl } from 'react-native';
import { MagnifyingGlassIcon, FunnelIcon } from 'react-native-heroicons/outline';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { ThreadItem } from './ThreadItem';
import { ThreadListSkeleton } from './MessageListSkeleton';
import type { EmailThread } from '@/lib/supabase/types';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { Campaign } from '@/lib/supabase/types';

export interface InboxThreadListProps {
  threads: EmailThread[];
  displayThreads: EmailThread[];
  threadsError: string | null;
  threadsLoadingOrNoAccount: boolean;
  showThreadSkeleton: boolean;
  threadSearchQuery: string;
  setThreadSearchQuery: (q: string) => void;
  filterButtonRef: RefObject<View | null>;
  onFilterPress: () => void;
  hasActiveFilters: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  loadMoreThreads: () => void;
  hasMoreThreads: boolean;
  loadingMoreThreads: boolean;
  leadDisplayNamesMap: Record<string, string>;
  campaigns: Campaign[];
  threadSnippetsMap: Record<string, string>;
  threadTagsMap: Record<string, ThreadTag[]>;
  onSelectThread: (threadId: string) => void;
  selectedThreadId: string | null;
  onRetryLoadThreads: () => void;
  /** Bottom padding for the list ScrollView (e.g. 6 for desktop, 6 + BOTTOM_NAV_SCROLL_PADDING for mobile) */
  scrollPaddingBottom: number;
}

export function InboxThreadList({
  threads,
  displayThreads,
  threadsError,
  threadsLoadingOrNoAccount,
  showThreadSkeleton,
  threadSearchQuery,
  setThreadSearchQuery,
  filterButtonRef,
  onFilterPress,
  hasActiveFilters,
  refreshing,
  onRefresh,
  loadMoreThreads,
  hasMoreThreads,
  loadingMoreThreads,
  leadDisplayNamesMap,
  campaigns,
  threadSnippetsMap,
  threadTagsMap,
  onSelectThread,
  selectedThreadId,
  onRetryLoadThreads,
  scrollPaddingBottom,
}: InboxThreadListProps) {
  return (
    <>
      <View className="px-4 py-4">
        <View className="flex-row items-center" style={{ minWidth: 0, gap: 10 }}>
          <View
            className="flex-1 flex-row items-center rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] px-3 py-2.5"
            style={{ borderWidth: 1, minWidth: 0 }}
          >
            <MagnifyingGlassIcon size={20} color="#6B7280" style={{ marginRight: 10 }} />
            <TextInput
              value={threadSearchQuery}
              onChangeText={setThreadSearchQuery}
              placeholder="Search conversations…"
              placeholderTextColor="#6B7280"
              className="flex-1 text-white font-instrument text-base py-0"
              style={{ minHeight: 24 }}
            />
          </View>
          <View ref={filterButtonRef} collapsable={false} style={{ flexShrink: 0 }}>
            <Pressable
              onPress={onFilterPress}
              className="rounded-xl border items-center justify-center"
              style={{
                width: 44,
                height: 44,
                backgroundColor: '#1A1A1A',
                borderColor: '#2A2A2A',
                borderWidth: 1,
              }}
            >
              <FunnelIcon
                size={18}
                color={hasActiveFilters ? '#F3440D' : '#9CA3AF'}
              />
            </Pressable>
          </View>
        </View>
      </View>
      {threadsError && (
        <View className="px-4 py-3">
          <Alert
            variant="error"
            message={threadsError}
            actionText="Retry"
            onAction={onRetryLoadThreads}
          />
        </View>
      )}
      {(threadsLoadingOrNoAccount || showThreadSkeleton) ? (
        <ThreadListSkeleton />
      ) : threads.length === 0 && !threadsError ? (
        <EmptyState
          title="No conversations yet"
          description="Replies to your campaign emails will appear here."
          className="flex-1 px-5"
        />
      ) : displayThreads.length === 0 ? (
        <EmptyState
          title="No matching conversations"
          description="Try a different search term."
          className="flex-1 px-5"
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingTop: 0, paddingBottom: scrollPaddingBottom }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {displayThreads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isSelected={selectedThreadId === thread.id}
              onSelect={() => onSelectThread(thread.id)}
              isUnread={'unread_count' in thread ? (thread as { unread_count: number }).unread_count > 0 : false}
              cardTitle={
                (thread.lead_id && leadDisplayNamesMap[thread.lead_id]) ||
                thread.participants?.[0] ||
                thread.subject ||
                '(No subject)'
              }
              campaignName={thread.campaign_id ? campaigns.find((c) => c.id === thread.campaign_id)?.name ?? null : null}
              sourceLabel={thread.smartlead_lead_id != null ? 'Smartlead' : null}
              preview={threadSnippetsMap[thread.id] ?? null}
              tags={threadTagsMap[thread.id] ?? []}
            />
          ))}
          {hasMoreThreads && (
            <Pressable
              onPress={loadMoreThreads}
              disabled={loadingMoreThreads}
              className="mx-3 mt-1.5 mb-3 py-2.5 rounded-xl items-center"
              style={{ backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A' }}
            >
              <Text className="text-orange-500 font-instrument text-sm">
                {loadingMoreThreads ? 'Loading…' : 'Load more'}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </>
  );
}
