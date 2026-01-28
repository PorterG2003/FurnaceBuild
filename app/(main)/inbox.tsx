import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { LoadingState, EmptyState, Alert } from '@/components/ui/feedback';
import {
  getAccountMembershipsForUser,
  getThreadsByAccount,
  getMessagesByThread,
  getUserByExternalId,
} from '@/lib/supabase/services';
import type { EmailThread, EmailMessage } from '@/lib/supabase/types';

function formatMessageDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (dateOnly.getTime() === today.getTime()) {
    return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (dateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function formatThreadDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Strip basic HTML tags for plain-text fallback. */
function stripHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function ThreadItem({
  thread,
  isSelected,
  onSelect,
}: {
  thread: EmailThread;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      className={`p-4 border-b border-[#2A2A2A] ${
        isSelected ? 'bg-[#1F1F1F]' : 'bg-transparent'
      }`}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: '#2A2A2A',
        backgroundColor: isSelected ? '#1F1F1F' : 'transparent',
      }}
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-2">
          <Text
            className="font-instrument-semibold text-base mb-1 text-gray-300"
            numberOfLines={1}
          >
            {thread.subject || '(No subject)'}
          </Text>
          <Text className="text-gray-400 font-instrument text-sm" numberOfLines={1}>
            {thread.participants?.length ? thread.participants.join(', ') : '—'}
          </Text>
        </View>
      </View>
      <Text className="text-gray-500 font-instrument text-xs">
        {formatThreadDate(thread.last_message_at)} · {thread.message_count} message{thread.message_count !== 1 ? 's' : ''}
      </Text>
    </Pressable>
  );
}

function MessageItem({ message }: { message: EmailMessage }) {
  const body = message.body_text || stripHtml(message.body_html);
  const sender = message.from_name || message.from_email;

  return (
    <View className="mb-6 pb-6 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-white font-instrument-semibold text-base">
              {sender}
            </Text>
            {message.direction === 'sent' && (
              <View className="bg-[#2A2A2A] px-2 py-0.5 rounded">
                <Text className="text-gray-400 font-instrument text-xs">Sent</Text>
              </View>
            )}
          </View>
          <Text className="text-gray-400 font-instrument text-sm">{message.from_email}</Text>
        </View>
        <Text className="text-gray-500 font-instrument text-sm">
          {formatMessageDate(message.received_at)}
        </Text>
      </View>
      <Text className="text-gray-300 font-instrument text-base leading-6">
        {body || '(No content)'}
      </Text>
    </View>
  );
}

export default function InboxPage() {
  const { user } = useAuthenticator();
  const externalId = user?.userId ?? null;

  const [accountId, setAccountId] = useState<string | null>(null);
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selectedThread = threads.find((t) => t.id === selectedThreadId);

  const handleRefresh = useCallback(async () => {
    if (!accountId) return;
    setRefreshing(true);
    try {
      const list = await getThreadsByAccount(accountId, { hasReplyOnly: true });
      setThreads(list);
      if (list.length === 0) {
        setSelectedThreadId(null);
      } else if (
        !selectedThreadId ||
        !list.some((t) => t.id === selectedThreadId)
      ) {
        setSelectedThreadId(list[0].id);
      }
    } finally {
      setRefreshing(false);
    }
  }, [accountId, selectedThreadId]);

  const loadThreads = useCallback(async () => {
    if (!accountId) return;
    setThreadsError(null);
    setThreadsLoading(true);
    try {
      const list = await getThreadsByAccount(accountId, { hasReplyOnly: true });
      setThreads(list);
      if (list.length === 0) {
        setSelectedThreadId(null);
      } else if (!selectedThreadId || !list.some((t) => t.id === selectedThreadId)) {
        setSelectedThreadId(list[0].id);
      }
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setThreadsLoading(false);
    }
  }, [accountId, selectedThreadId]);

  const loadMessages = useCallback(async (threadId: string) => {
    setMessagesError(null);
    setMessagesLoading(true);
    try {
      const list = await getMessagesByThread(threadId);
      setMessages(list);
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!externalId) return;
    let cancelled = false;
    (async () => {
      try {
        const userProfile = await getUserByExternalId(externalId);
        if (!userProfile || cancelled) return;
        const memberships = await getAccountMembershipsForUser(userProfile.id);
        if (cancelled) return;
        if (memberships.length > 0) {
          const primary = memberships.find((m) => m.membership.is_owner) ?? memberships[0];
          setAccountId(primary.account.id);
        }
      } catch {
        if (!cancelled) setAccountId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [externalId]);

  useEffect(() => {
    if (accountId) {
      loadThreads();
    } else {
      setThreadsLoading(false);
      setThreads([]);
    }
  }, [accountId, loadThreads]);

  useEffect(() => {
    if (selectedThreadId) {
      loadMessages(selectedThreadId);
    } else {
      setMessages([]);
    }
  }, [selectedThreadId, loadMessages]);

  return (
    <PageLayout scrollable={false}>
      <View className="flex-1 flex-row bg-[#121212]">
        {/* Threads Panel */}
        <View className="w-96 border-r border-[#2A2A2A]" style={{ borderRightWidth: 1 }}>
          <View className="p-4 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
            <Text className="text-2xl font-instrument-semibold text-white mb-1">Inbox</Text>
            <Text className="text-gray-400 font-instrument text-sm">
              {threads.length} conversation{threads.length !== 1 ? 's' : ''}
            </Text>
          </View>
          {threadsError && (
            <View className="p-4">
              <Alert
                variant="error"
                message={threadsError}
                actionText="Retry"
                onAction={() => loadThreads()}
              />
            </View>
          )}
          {threadsLoading ? (
            <LoadingState message="Loading conversations…" className="flex-1" />
          ) : threads.length === 0 && !threadsError ? (
            <EmptyState
              title="No conversations yet"
              description="Replies to your campaign emails will appear here."
              className="flex-1 px-4"
            />
          ) : (
            <ScrollView
              className="flex-1"
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
              }
            >
              {threads.map((thread) => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  isSelected={selectedThreadId === thread.id}
                  onSelect={() => setSelectedThreadId(thread.id)}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* Message Panel */}
        <View className="flex-1">
          {selectedThread ? (
            <>
              <View className="p-4 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
                <Text className="text-xl font-instrument-semibold text-white mb-1">
                  {selectedThread.subject || '(No subject)'}
                </Text>
                <Text className="text-gray-400 font-instrument text-sm">
                  {selectedThread.participants?.length ? selectedThread.participants.join(', ') : '—'}
                </Text>
              </View>
              {messagesError && (
                <View className="p-4">
                  <Alert
                    variant="error"
                    message={messagesError}
                    actionText="Retry"
                    onAction={() => selectedThreadId && loadMessages(selectedThreadId)}
                  />
                </View>
              )}
              {messagesLoading ? (
                <LoadingState message="Loading messages…" className="flex-1" />
              ) : (
                <ScrollView
                  className="flex-1"
                  contentContainerStyle={{ padding: 24 }}
                  showsVerticalScrollIndicator={false}
                >
                  {messages.map((message) => (
                    <MessageItem key={message.id} message={message} />
                  ))}
                </ScrollView>
              )}
            </>
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-gray-400 font-instrument text-lg">
                Select a conversation to view messages
              </Text>
            </View>
          )}
        </View>
      </View>
    </PageLayout>
  );
}
