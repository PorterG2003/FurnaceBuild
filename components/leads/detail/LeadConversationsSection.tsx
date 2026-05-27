import { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { openAppRoute } from '@/lib/navigation/openAppRoute';
import { ChevronRightIcon } from 'react-native-heroicons/outline';
import { TagChipRow } from '@/components/tags';
import { EmptyState } from '@/components/ui/feedback';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import type { AccountLeadDetail } from '@/lib/leads/types';
import {
  LeadDetailListRow,
  LeadDetailListShell,
  LeadDetailSection,
  useLeadDetailLayout,
} from './leadDetailLayout';
import { useLeadDetailMobilePage } from './mobile/LeadDetailMobilePageContext';

export function LeadConversationsSection({ detail }: { detail: AccountLeadDetail }) {
  const router = useRouter();
  const { isMobile } = useLeadDetailLayout();
  const { suppressSectionHeader: isMobileDrill } = useLeadDetailMobilePage();

  const campaignNameById = useMemo(
    () => new Map(detail.campaigns.map((campaign) => [campaign.id, campaign.name])),
    [detail.campaigns],
  );

  const threads = useMemo(
    () => [...detail.threads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    [detail.threads],
  );

  if (threads.length === 0) {
    return (
      <LeadDetailSection title="Conversations">
        <EmptyState
          title="No conversations"
          description={isMobileDrill ? undefined : 'No inbox threads are linked to this lead yet.'}
        />
      </LeadDetailSection>
    );
  }

  return (
    <LeadDetailSection title="Conversations">
      <LeadDetailListShell>
        {threads.map((thread, index) => {
          const tags = detail.threadTagsByThreadId[thread.id] ?? [];
          const categoryColor = thread.category ? getCategoryColor(thread.category) : null;

          return (
            <LeadDetailListRow key={thread.id} isLast={index === threads.length - 1}>
              <Pressable
                className="gap-2"
                onPress={() =>
                  openAppRoute(router, { pathname: '/inbox', params: { thread: thread.id } }, { newTab: true })
                }
              >
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="flex-1 text-white font-instrument-semibold text-sm leading-5" numberOfLines={2}>
                    {thread.subject || 'No subject'}
                  </Text>
                  <View className="flex-row items-center gap-1 shrink-0">
                    <Text className="text-xs text-gray-500 font-instrument">
                      {format(new Date(thread.lastMessageAt), isMobileDrill ? 'MMM d' : 'MMM d, h:mm a')}
                    </Text>
                    {!isMobile ? <ChevronRightIcon size={14} color="#6b7280" /> : null}
                  </View>
                </View>

                {isMobileDrill ? (
                  <View className="flex-row flex-wrap items-center gap-2">
                    {thread.campaignId ? (
                      <Text className="text-xs text-gray-500 font-instrument" numberOfLines={1}>
                        {campaignNameById.get(thread.campaignId) ?? 'Campaign'}
                      </Text>
                    ) : null}
                    {thread.category ? (
                      <Text
                        className="text-xs font-instrument-semibold"
                        style={{ color: categoryColor ?? '#94A3B8' }}
                      >
                        {thread.category}
                      </Text>
                    ) : null}
                    {thread.hasReply ? (
                      <Text className="text-xs text-[#34D399] font-instrument-semibold">Replied</Text>
                    ) : null}
                    {thread.outOfOffice ? (
                      <Text className="text-xs text-[#FACC15] font-instrument-semibold">OOO</Text>
                    ) : null}
                  </View>
                ) : (
                  <>
                    <View className="flex-row flex-wrap items-center gap-2">
                      {thread.campaignId ? (
                        <View className="rounded-md border border-[#2A2A2A] bg-[#181818] px-2 py-0.5">
                          <Text className="text-xs text-gray-400 font-instrument" numberOfLines={1}>
                            {campaignNameById.get(thread.campaignId) ?? 'Campaign'}
                          </Text>
                        </View>
                      ) : null}
                      {thread.category ? (
                        <View
                          className="rounded-lg px-2 py-0.5"
                          style={{
                            backgroundColor: categoryColor ? `${categoryColor}26` : 'rgba(148, 163, 184, 0.15)',
                          }}
                        >
                          <Text
                            className="text-xs font-instrument-semibold"
                            style={{ color: categoryColor ?? '#94A3B8' }}
                          >
                            {thread.category}
                          </Text>
                        </View>
                      ) : null}
                      {thread.hasReply ? (
                        <Text className="text-xs text-[#34D399] font-instrument-semibold">Has reply</Text>
                      ) : null}
                      {thread.outOfOffice ? (
                        <Text className="text-xs text-[#FACC15] font-instrument-semibold">OOO</Text>
                      ) : null}
                      <Text className="text-xs text-gray-500 font-instrument">
                        {thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}
                      </Text>
                    </View>

                    {tags.length > 0 ? (
                      <TagChipRow tags={tags} maxVisible={4} />
                    ) : null}
                  </>
                )}

                {isMobileDrill && tags.length > 0 ? (
                  <TagChipRow tags={tags} maxVisible={3} />
                ) : null}
              </Pressable>
            </LeadDetailListRow>
          );
        })}
      </LeadDetailListShell>
    </LeadDetailSection>
  );
}
