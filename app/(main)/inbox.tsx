import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  type DimensionValue,
} from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { EmptyState, Alert, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import {
  getAccountMembershipsForUser,
  getThreadsByAccount,
  getMessagesByThread,
  getUserByExternalId,
  createReplyJob,
  getMessageJobStatus,
  getPendingInboxReplyJobs,
} from '@/lib/supabase/services';
import type { EmailThread, EmailMessage } from '@/lib/supabase/types';
import { getDisplayBody } from '@/lib/email';
import { ArrowUturnLeftIcon, ArrowPathIcon, ExclamationCircleIcon } from 'react-native-heroicons/outline';

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

/** Date group label for dividers: Today, Yesterday, Mon Jan 27, or Jan 15, 2026 */
function getDateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (dateOnly.getTime() === today.getTime()) return 'Today';
  if (dateOnly.getTime() === yesterday.getTime()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function groupMessagesByDate(messages: EmailMessage[]): { label: string; messages: EmailMessage[] }[] {
  const groups: { label: string; messages: EmailMessage[] }[] = [];
  let currentLabel: string | null = null;
  let currentGroup: EmailMessage[] = [];
  for (const m of messages) {
    const label = getDateGroupLabel(m.received_at);
    if (label !== currentLabel) {
      if (currentGroup.length > 0) {
        groups.push({ label: currentLabel!, messages: currentGroup });
      }
      currentLabel = label;
      currentGroup = [m];
    } else {
      currentGroup.push(m);
    }
  }
  if (currentGroup.length > 0) {
    groups.push({ label: currentLabel!, messages: currentGroup });
  }
  return groups;
}

const SKELETON_DELAY_MS = 200;
const SKELETON_MIN_DISPLAY_MS = 300;
const STAGGER_DELAY_MS = 60;

/** Wrapper that fades in children with a staggered delay based on index. */
function StaggeredFadeIn({ index, children }: { index: number; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }, index * STAGGER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [index, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/** Per-item width variations (pixels) for a more organic skeleton look. */
const THREAD_SKELETON_WIDTHS: [number, number, number][] = [
  [280, 220, 160],
  [260, 200, 140],
  [290, 180, 120],
  [250, 210, 155],
  [270, 230, 135],
  [255, 195, 170],
  [285, 240, 125],
  [265, 205, 150],
];

/** Skeleton loading for thread list (left panel). Only shown after 200ms delay. */
function ThreadListSkeleton() {
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 12 }}
      showsVerticalScrollIndicator={false}
    >
      {THREAD_SKELETON_WIDTHS.map(([w1, w2, w3], i) => (
        <StaggeredFadeIn key={i} index={i}>
          <View
            className="mx-3 mb-2 rounded-xl border border-[#2A2A2A] px-4 py-3"
            style={{ borderWidth: 1 }}
          >
            <Skeleton style={{ width: w1, height: 16, borderRadius: 4 }} />
            <Skeleton style={{ width: w2, height: 12, borderRadius: 4, marginTop: 8 }} />
            <Skeleton style={{ width: w3, height: 12, borderRadius: 4, marginTop: 8 }} />
          </View>
        </StaggeredFadeIn>
      ))}
    </ScrollView>
  );
}

/** Body line widths per message card (percentage) for varied skeleton appearance. */
const MESSAGE_BODY_WIDTHS: DimensionValue[][] = [
  ['100%', '94%', '78%'],
  ['98%', '88%', '72%', '55%'],
  ['100%', '90%', '70%'],
  ['96%', '82%', '65%'],
];

function DateDividerSkeleton({ index }: { index: number }) {
  return (
    <StaggeredFadeIn index={index}>
      <View className="py-5 flex-row items-center justify-center px-2">
        <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
        <View className="mx-3">
          <Skeleton style={{ width: 100, height: 24, borderRadius: 12 }} />
        </View>
        <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
      </View>
    </StaggeredFadeIn>
  );
}

function MessageCardSkeleton({
  bodyWidths,
  index,
}: {
  bodyWidths: DimensionValue[];
  index: number;
}) {
  return (
    <StaggeredFadeIn index={index}>
      <View
        className="mb-4 rounded-xl overflow-hidden border border-[#2A2A2A]"
        style={{
          width: '92%',
          alignSelf: 'center',
          borderWidth: 1,
          backgroundColor: '#1A1A1A',
        }}
      >
        <View className="px-5 pt-4 pb-3 flex-row items-center">
          <Skeleton style={{ width: 40, height: 40, borderRadius: 20 }} />
          <View className="ml-3 flex-1">
            <Skeleton className="h-4 mb-1.5" style={{ width: '70%', borderRadius: 4 }} />
            <Skeleton className="h-3" style={{ width: '52%', borderRadius: 4 }} />
          </View>
          <Skeleton className="h-3 flex-shrink-0" style={{ width: 72, borderRadius: 4 }} />
        </View>
        <View className="mx-5 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }} />
        <View className="px-5 py-4">
          {bodyWidths.map((w, j) => (
            <Skeleton
              key={j}
              className={j < bodyWidths.length - 1 ? 'mb-2' : ''}
              style={{ width: w, height: 12, borderRadius: 4 }}
            />
          ))}
        </View>
      </View>
    </StaggeredFadeIn>
  );
}

/** Skeleton loading for message list (right panel). Only shown after 200ms delay. */
function MessageListSkeleton() {
  return (
    <ScrollView
      className="flex-1 bg-[#121212]"
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      <DateDividerSkeleton index={0} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[0]} index={1} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[1]} index={2} />
      <DateDividerSkeleton index={3} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[2]} index={4} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[3]} index={5} />
    </ScrollView>
  );
}

/** Centered date divider with pill-style label */
function DateDivider({ label }: { label: string }) {
  return (
    <View className="flex-row items-center justify-center py-5 px-2">
      <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
      <View className="mx-3 rounded-full bg-[#1A1A1A] border border-[#2A2A2A] px-4 py-1.5">
        <Text className="text-gray-500 font-instrument-medium text-xs">{label}</Text>
      </View>
      <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
    </View>
  );
}

/** Initials from name or email (e.g. "Sarah Johnson" -> "SJ", "sarah@co.com" -> "sa") */
function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
    }
    return name.slice(0, 2).toUpperCase();
  }
  const local = email.split('@')[0] || '';
  return (local.slice(0, 2) || '?').toUpperCase();
}

/** Single message bubble: centered card with avatar and Reply in header */
function MessageBubble({
  message,
  onReply,
  isPending,
  isFailed,
  errorMessage,
  onRetry,
}: {
  message: EmailMessage;
  onReply?: (message: EmailMessage) => void;
  isPending?: boolean;
  isFailed?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}) {
  const rawBody = message.body_text ?? message.body_html ?? '';
  const body = getDisplayBody(rawBody, {
    format: message.body_text ? 'text' : 'html',
  });
  const sender = message.from_name || message.from_email;
  const isSent = message.direction === 'sent';
  const canReply = onReply != null && !isPending && !isFailed;
  const showRetry = isFailed && onRetry != null;

  const borderPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isPending || isFailed) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(borderPulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: false,
        }),
        Animated.timing(borderPulse, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isPending, isFailed, borderPulse]);

  const animatedBorderColor = borderPulse.interpolate({
    inputRange: [0, 1],
    outputRange: ['#2A2A2A', 'rgba(243, 68, 13, 0.55)'],
  });

  const cardContent = (
    <View
      className="rounded-xl w-[92%] max-w-[92%] overflow-hidden"
      style={{
        backgroundColor: isSent ? '#1E1E1E' : '#1A1A1A',
        borderWidth: isPending || isFailed ? 0 : 1,
        borderColor: isPending || isFailed ? 'transparent' : '#2A2A2A',
      }}
    >
      {isPending && !isFailed ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 2,
            borderRadius: 12,
            borderColor: animatedBorderColor,
          }}
        />
      ) : null}
      {isFailed ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 2,
            borderRadius: 12,
            borderColor: '#EF4444',
          }}
        />
      ) : null}
      <View className="px-5 pt-4 pb-3">
        <View className="flex-row items-center justify-between flex-wrap gap-2">
          <View className="flex-row items-center flex-1 min-w-0">
            <View
              className="w-10 h-10 rounded-full items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#2A2A2A' }}
            >
              <Text className="text-white font-instrument-semibold text-sm">
                {getInitials(message.from_name, message.from_email)}
              </Text>
            </View>
            <View className="ml-3 items-start flex-1 min-w-0">
              <Text className="text-white font-instrument-semibold text-base" numberOfLines={1}>
                {isSent ? 'You' : sender}
              </Text>
              <Text className="text-gray-400 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {message.from_email}
              </Text>
            </View>
            <Text className="text-gray-500 font-instrument text-xs flex-shrink-0 ml-2">
              {isFailed ? 'Failed' : isPending ? 'Sending…' : formatMessageDate(message.received_at)}
            </Text>
          </View>
          {showRetry && (
            <Pressable
              onPress={onRetry}
              className="flex-row items-center gap-2 rounded-lg px-3 py-2 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)' }}
            >
              <ArrowPathIcon size={16} color="#EF4444" />
              <Text className="font-instrument-medium text-sm" style={{ color: '#EF4444' }}>
                Retry
              </Text>
            </Pressable>
          )}
          {canReply && (
            <Pressable
              onPress={() => onReply(message)}
              className="flex-row items-center gap-2 rounded-lg px-3 py-2 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(243, 68, 13, 0.12)' }}
            >
              <ArrowUturnLeftIcon size={16} color="#F3440D" />
              <Text className="font-instrument-medium text-sm" style={{ color: '#F3440D' }}>
                Reply
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <View className="mx-5 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }} />
      <View className="px-5 py-4">
        {isFailed && errorMessage ? (
          <View className="mb-3 flex-row items-start gap-2 rounded-lg p-3" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <ExclamationCircleIcon size={18} color="#EF4444" style={{ marginTop: 2 }} />
            <View className="flex-1">
              <Text className="text-red-400 font-instrument-semibold text-sm mb-1">Failed to send</Text>
              <Text className="text-red-300 font-instrument text-xs">{errorMessage}</Text>
            </View>
          </View>
        ) : null}
        <Text className="text-gray-300 font-instrument text-sm leading-6 text-left">
          {body || '(No content)'}
        </Text>
      </View>
    </View>
  );

  return (
    <View className="mb-4 flex-row justify-center items-center">
      {cardContent}
    </View>
  );
}

/** Sticky header: subject, then prospect(s) vs sender with clear separation */
function MessagePanelHeader({
  subject,
  prospectEmails,
  senderEmails,
}: {
  subject: string;
  prospectEmails: string[];
  senderEmails: string[];
}) {
  return (
    <View
      className="px-5 py-4 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <Text
        className="text-xl font-instrument-semibold text-white"
        numberOfLines={1}
      >
        {subject || '(No subject)'}
      </Text>
      <View className="mt-3 gap-0">
        {prospectEmails.length > 0 && (
          <View className="flex-row items-center gap-3 py-1.5">
            <View className="rounded-md bg-[#1A1A1A] px-2 py-0.5 self-start">
              <Text className="text-gray-500 font-instrument-medium text-xs">
                Prospect{prospectEmails.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <Text className="text-gray-300 font-instrument text-sm flex-1" numberOfLines={2}>
              {prospectEmails.join(', ')}
            </Text>
          </View>
        )}
        {senderEmails.length > 0 && (
          <View className="flex-row items-center gap-3 py-1.5">
            <View className="rounded-md bg-[#1A1A1A] px-2 py-0.5 self-start">
              <Text className="text-gray-500 font-instrument-medium text-xs">
                Your email
              </Text>
            </View>
            <Text className="text-gray-300 font-instrument text-sm flex-1" numberOfLines={2}>
              {senderEmails.join(', ')}
            </Text>
          </View>
        )}
        {prospectEmails.length === 0 && senderEmails.length === 0 && (
          <Text className="text-gray-500 font-instrument text-sm py-2">—</Text>
        )}
      </View>
    </View>
  );
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
      className={`mx-3 mb-2 rounded-xl border px-4 py-3 ${
        isSelected ? 'bg-[#1A1A1A]' : 'bg-[#121212]'
      }`}
      style={{
        borderWidth: 1,
        borderColor: isSelected ? '#3A2A22' : '#2A2A2A',
        borderLeftWidth: isSelected ? 3 : 1,
        borderLeftColor: isSelected ? '#F3440D' : '#2A2A2A',
      }}
    >
      <Text
        className="font-instrument-semibold text-base text-white mb-1"
        numberOfLines={1}
      >
        {thread.subject || '(No subject)'}
      </Text>
      <Text className="text-gray-400 font-instrument text-sm mb-2" numberOfLines={1}>
        {thread.participants?.length ? thread.participants.join(', ') : '—'}
      </Text>
      <Text className="text-gray-500 font-instrument text-xs">
        {formatThreadDate(thread.last_message_at)} · {thread.message_count} message{thread.message_count !== 1 ? 's' : ''}
      </Text>
    </Pressable>
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
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [inReplyToMessageId, setInReplyToMessageId] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState('');
  const [replyToName, setReplyToName] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [showThreadSkeleton, setShowThreadSkeleton] = useState(false);
  const [showMessagesSkeleton, setShowMessagesSkeleton] = useState(false);

  type PendingReply = {
    threadId: string;
    jobId: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    toEmail: string;
    toName: string | null;
    cc: string[];
    fromEmail: string;
    receivedAt: string;
    messageCountWhenPending: number;
    errorMessage?: string | null;
    isFailed?: boolean;
    inReplyToMessageId: string;
  };
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesScrollViewRef = useRef<ScrollView>(null);

  const threadSkeletonTimers = useRef<{ show: ReturnType<typeof setTimeout> | null; hide: ReturnType<typeof setTimeout> | null }>({ show: null, hide: null });
  const messagesSkeletonTimers = useRef<{ show: ReturnType<typeof setTimeout> | null; hide: ReturnType<typeof setTimeout> | null }>({ show: null, hide: null });

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const threadsLoadingOrNoAccount = threadsLoading || !accountId;

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

  const loadMessages = useCallback(async (threadId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setMessagesError(null);
      setMessagesLoading(true);
    }
    try {
      const list = await getMessagesByThread(threadId);
      setMessages(list);
    } catch (err) {
      if (!options?.silent) {
        setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
      }
    } finally {
      if (!options?.silent) {
        setMessagesLoading(false);
      }
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

  // Restore pending reply from database for the selected thread
  const restorePendingReply = useCallback(async () => {
    if (!accountId || !selectedThreadId) return;
    try {
      const pendingJobs = await getPendingInboxReplyJobs(accountId);
      const jobForThread = pendingJobs.find((j) => j.thread_id === selectedThreadId);
      if (!jobForThread) return;

      // Get fromEmail from sent messages in the thread
      const threadMessages = await getMessagesByThread(selectedThreadId);
      const fromEmail = threadMessages.find((m) => m.direction === 'sent')?.from_email ?? '';

      setPendingReply({
        threadId: jobForThread.thread_id,
        jobId: jobForThread.id,
        subject: jobForThread.message_data.subject,
        bodyText: jobForThread.message_data.body_text,
        bodyHtml: jobForThread.message_data.body_html,
        toEmail: jobForThread.message_data.to_email,
        toName: jobForThread.message_data.to_name || null,
        cc: jobForThread.message_data.cc || [],
        fromEmail,
        receivedAt: new Date().toISOString(), // Use current time for display
        messageCountWhenPending: threadMessages.length,
        errorMessage: jobForThread.error_message,
        isFailed: jobForThread.status === 'failed',
        inReplyToMessageId: jobForThread.message_data.in_reply_to_message_id,
      });

      // Start polling for this job
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      const jobIdToPoll = jobForThread.id;
      pollingIntervalRef.current = setInterval(async () => {
        loadMessages(selectedThreadId, { silent: true });
        // Check job status
        try {
          const jobStatus = await getMessageJobStatus(jobIdToPoll);
          if (jobStatus) {
            if (jobStatus.status === 'failed') {
              setPendingReply((prev) =>
                prev && prev.jobId === jobIdToPoll
                  ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                  : prev
              );
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            } else if (jobStatus.status === 'sent') {
              // Job succeeded, clear pending when message appears
              // (handled by the effect checking messages.length)
            }
          }
        } catch (err) {
          console.error('Failed to check job status:', err);
        }
      }, 2000);
    } catch (err) {
      console.error('Failed to restore pending reply:', err);
    }
  }, [accountId, selectedThreadId, loadMessages]);

  useEffect(() => {
    if (accountId) {
      loadThreads();
    } else {
      setThreadsLoading(false);
      setThreads([]);
    }
  }, [accountId, loadThreads]);

  // Restore pending reply when thread is selected
  useEffect(() => {
    if (accountId && selectedThreadId && !threadsLoading) {
      restorePendingReply();
    }
  }, [accountId, selectedThreadId, threadsLoading, restorePendingReply]);

  useEffect(() => {
    if (selectedThreadId) {
      loadMessages(selectedThreadId);
    } else {
      setMessages([]);
    }
  }, [selectedThreadId, loadMessages]);

  // Thread skeleton: delay 200ms before showing, min 300ms once shown
  useEffect(() => {
    const t = threadSkeletonTimers.current;
    if (threadsLoadingOrNoAccount) {
      if (t.hide) {
        clearTimeout(t.hide);
        t.hide = null;
      }
      t.show = setTimeout(() => setShowThreadSkeleton(true), SKELETON_DELAY_MS);
      return () => {
        if (t.show) clearTimeout(t.show);
        t.show = null;
      };
    } else {
      if (t.show) {
        clearTimeout(t.show);
        t.show = null;
      }
      if (showThreadSkeleton) {
        t.hide = setTimeout(() => setShowThreadSkeleton(false), SKELETON_MIN_DISPLAY_MS);
        return () => {
          if (t.hide) clearTimeout(t.hide);
          t.hide = null;
        };
      }
    }
  }, [threadsLoadingOrNoAccount, showThreadSkeleton]);

  // Messages skeleton: delay 200ms before showing, min 300ms once shown
  useEffect(() => {
    const t = messagesSkeletonTimers.current;
    if (messagesLoading) {
      if (t.hide) {
        clearTimeout(t.hide);
        t.hide = null;
      }
      t.show = setTimeout(() => setShowMessagesSkeleton(true), SKELETON_DELAY_MS);
      return () => {
        if (t.show) clearTimeout(t.show);
        t.show = null;
      };
    } else {
      if (t.show) {
        clearTimeout(t.show);
        t.show = null;
      }
      if (showMessagesSkeleton) {
        t.hide = setTimeout(() => setShowMessagesSkeleton(false), SKELETON_MIN_DISPLAY_MS);
        return () => {
          if (t.hide) clearTimeout(t.hide);
          t.hide = null;
        };
      }
    }
  }, [messagesLoading, showMessagesSkeleton]);

  // Clear pending reply when thread changes or when sent message appears (polling)
  useEffect(() => {
    if (!pendingReply) return;
    if (selectedThreadId !== pendingReply.threadId) {
      setPendingReply(null);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }
    // If failed, don't clear on message count change (user needs to see error)
    if (!pendingReply.isFailed && messages.length > pendingReply.messageCountWhenPending) {
      setPendingReply(null);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [pendingReply, selectedThreadId, messages.length]);

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  const scrollMessagesToEnd = useCallback(() => {
    messagesScrollViewRef.current?.scrollToEnd({ animated: true });
  }, []);

  const openReplyComposer = useCallback(
    (message: EmailMessage) => {
      if (!selectedThread) return;
      const lastReceived = [...messages].reverse().find((m) => m.direction === 'received');
      const toEmail = message.direction === 'received' ? message.from_email : lastReceived?.from_email ?? '';
      const toName = message.direction === 'received' ? (message.from_name ?? '') : (lastReceived?.from_name ?? '');
      setInReplyToMessageId(message.id);
      setReplyToEmail(toEmail);
      setReplyToName(toName);
      setReplySubject(selectedThread.subject?.startsWith('Re:') ? selectedThread.subject : `Re: ${selectedThread.subject || '(No subject)'}`);
      setReplyBody('');

      // Prefill CC from whole thread history (participants), excluding To and our sending identity
      const ourEmail = messages.find((m) => m.direction === 'sent')?.from_email?.trim().toLowerCase();
      const toNorm = toEmail.trim().toLowerCase();
      const ccSeen = new Set<string>();
      const ccList: string[] = [];
      for (const p of selectedThread.participants ?? []) {
        const e = p.trim();
        if (!e) continue;
        const n = e.toLowerCase();
        if (n === toNorm || n === ourEmail || ccSeen.has(n)) continue;
        ccSeen.add(n);
        ccList.push(e);
      }
      setReplyCc(ccList.join(', '));

      setReplyError(null);
      setShowReplyComposer(true);
    },
    [selectedThread, messages]
  );

  const winWidth = Dimensions.get('window').width;
  const REPLY_PANEL_WIDTH = Math.min(560, Math.max(400, winWidth * 0.42));
  const slideAnim = useRef(new Animated.Value(1)).current;

  const closeReplyPanel = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setShowReplyComposer(false));
  }, [slideAnim]);

  useEffect(() => {
    if (showReplyComposer) {
      slideAnim.setValue(1);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    }
  }, [showReplyComposer, slideAnim]);

  const retryFailedReply = useCallback(async () => {
    if (!accountId || !selectedThreadId || !selectedThread || !pendingReply || !pendingReply.isFailed) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const jobId = await createReplyJob({
        accountId,
        threadId: selectedThreadId,
        inReplyToMessageId: inReplyToMessageId!,
        subject: pendingReply.subject,
        bodyText: pendingReply.bodyText,
        bodyHtml: pendingReply.bodyText,
        toEmail: pendingReply.toEmail,
        toName: null,
        cc: undefined,
      });
      const fromEmail = messages.find((m) => m.direction === 'sent')?.from_email ?? '';
      const receivedAt = new Date().toISOString();
      setPendingReply({
        threadId: selectedThreadId,
        jobId,
        subject: pendingReply.subject,
        bodyText: pendingReply.bodyText,
        bodyHtml: pendingReply.bodyHtml,
        toEmail: pendingReply.toEmail,
        toName: pendingReply.toName,
        cc: pendingReply.cc,
        fromEmail,
        receivedAt,
        messageCountWhenPending: messages.length,
        inReplyToMessageId: pendingReply.inReplyToMessageId,
      });
      loadMessages(selectedThreadId);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      pollingIntervalRef.current = setInterval(async () => {
        loadMessages(selectedThreadId, { silent: true });
        // Check job status for failures
        try {
          const jobStatus = await getMessageJobStatus(jobId);
          if (jobStatus) {
            if (jobStatus.status === 'failed') {
              setPendingReply((prev) =>
                prev && prev.jobId === jobId
                  ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                  : prev
              );
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            } else if (jobStatus.status === 'sent') {
              // Job succeeded, clear pending when message appears
              // (handled by the effect checking messages.length)
            }
          }
        } catch (err) {
          // Ignore errors checking job status, continue polling
          console.error('Failed to check job status:', err);
        }
      }, 2000);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Failed to retry reply');
    } finally {
      setSendingReply(false);
    }
  }, [accountId, selectedThreadId, selectedThread, pendingReply, messages, loadMessages]);

  const sendReply = useCallback(async () => {
    if (!accountId || !selectedThreadId || !selectedThread || !inReplyToMessageId) return;
    if (!replyToEmail.trim()) {
      setReplyError('To is required');
      return;
    }
    setSendingReply(true);
    setReplyError(null);
    try {
      const jobId = await createReplyJob({
        accountId,
        threadId: selectedThreadId,
        inReplyToMessageId,
        subject: replySubject.trim() || '(No subject)',
        bodyText: replyBody.trim() || '',
        bodyHtml: replyBody.trim() || '',
        toEmail: replyToEmail.trim(),
        toName: replyToName.trim() || null,
        cc: replyCc.trim() ? replyCc.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) : undefined,
      });
      const fromEmail = messages.find((m) => m.direction === 'sent')?.from_email ?? '';
      const receivedAt = new Date().toISOString();
      const ccArray = replyCc.trim() ? replyCc.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) : [];
      setPendingReply({
        threadId: selectedThreadId,
        jobId,
        subject: replySubject.trim() || '(No subject)',
        bodyText: replyBody.trim() || '',
        bodyHtml: replyBody.trim() || '',
        toEmail: replyToEmail.trim(),
        toName: replyToName.trim() || null,
        cc: ccArray,
        fromEmail,
        receivedAt,
        messageCountWhenPending: messages.length,
        inReplyToMessageId,
      });
      closeReplyPanel();
      loadMessages(selectedThreadId);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      pollingIntervalRef.current = setInterval(async () => {
        loadMessages(selectedThreadId, { silent: true });
        // Check job status for failures
        try {
          const jobStatus = await getMessageJobStatus(jobId);
          if (jobStatus) {
            if (jobStatus.status === 'failed') {
              setPendingReply((prev) =>
                prev && prev.jobId === jobId
                  ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                  : prev
              );
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            } else if (jobStatus.status === 'sent') {
              // Job succeeded, clear pending when message appears
              // (handled by the effect checking messages.length)
            }
          }
        } catch (err) {
          // Ignore errors checking job status, continue polling
          console.error('Failed to check job status:', err);
        }
      }, 2000);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  }, [accountId, selectedThreadId, selectedThread, inReplyToMessageId, replyToEmail, replyToName, replySubject, replyBody, replyCc, messages, loadMessages, closeReplyPanel]);

  return (
    <PageLayout scrollable={false}>
      <View className="flex-1 flex-row bg-[#121212]">
        {/* Threads + Message content (slides left when reply panel opens) */}
        <View style={{ flex: 1, minWidth: 0 }} className="flex-row">
        {/* Threads Panel */}
        <View className="w-96 border-r border-[#2A2A2A] bg-[#0D0D0D]" style={{ borderRightWidth: 1 }}>
          <View className="px-5 py-5 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
            <Text className="text-2xl font-instrument-semibold text-white mb-1">Inbox</Text>
            <Text className="text-gray-400 font-instrument text-sm">
              {threads.length} conversation{threads.length !== 1 ? 's' : ''} · Replies from prospects
            </Text>
          </View>
          {threadsError && (
            <View className="px-4 py-3">
              <Alert
                variant="error"
                message={threadsError}
                actionText="Retry"
                onAction={() => loadThreads()}
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
          ) : (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingVertical: 8 }}
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
          {(threadsLoadingOrNoAccount || showThreadSkeleton) ? (
            <MessageListSkeleton />
          ) : selectedThread ? (
            <>
              {(() => {
                const displayMessages: EmailMessage[] =
                  pendingReply && selectedThreadId === pendingReply.threadId
                    ? [
                        ...messages,
                        {
                          id: `pending-${pendingReply.jobId}`,
                          thread_id: selectedThreadId!,
                          message_job_id: pendingReply.jobId,
                          direction: 'sent' as const,
                          from_email: pendingReply.fromEmail,
                          from_name: null,
                          to_email: pendingReply.toEmail,
                          to_name: null,
                          cc: null,
                          subject: pendingReply.subject,
                          body_text: pendingReply.bodyText,
                          body_html: pendingReply.bodyHtml,
                          message_id: null,
                          in_reply_to: null,
                          message_references: null,
                          received_at: pendingReply.receivedAt,
                          read_at: null,
                          headers: {},
                          attachments: [],
                          imap_uid: null,
                          created_at: pendingReply.receivedAt,
                          updated_at: pendingReply.receivedAt,
                        },
                      ].sort(
                        (a, b) =>
                          new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
                      )
                    : messages;
                return (
                  <>
              <MessagePanelHeader
                subject={selectedThread.subject ?? ''}
                prospectEmails={[
                  ...new Set(
                    displayMessages.filter((m) => m.direction === 'received').map((m) => m.from_email)
                  ),
                ]}
                senderEmails={[
                  ...new Set(
                    displayMessages.filter((m) => m.direction === 'sent').map((m) => m.from_email)
                  ),
                ]}
              />
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
              {showMessagesSkeleton ? (
                <MessageListSkeleton />
              ) : (
                <ScrollView
                  ref={messagesScrollViewRef}
                  onContentSizeChange={scrollMessagesToEnd}
                  className="flex-1 bg-[#121212]"
                  contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 }}
                  showsVerticalScrollIndicator={false}
                >
                  {groupMessagesByDate(displayMessages).map((group) => (
                    <View key={group.label}>
                      <DateDivider label={group.label} />
                      {group.messages.map((message) => {
                        const isPendingMessage = message.id.startsWith('pending-');
                        const pendingInfo = isPendingMessage && pendingReply && selectedThreadId === pendingReply.threadId
                          ? pendingReply
                          : null;
                        return (
                          <MessageBubble
                            key={message.id}
                            message={message}
                            onReply={openReplyComposer}
                            isPending={isPendingMessage && !pendingInfo?.isFailed}
                            isFailed={pendingInfo?.isFailed ?? false}
                            errorMessage={pendingInfo?.errorMessage}
                            onRetry={pendingInfo?.isFailed ? retryFailedReply : undefined}
                          />
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
              )}
                  </>
                );
              })()}
            </>
          ) : (
            <View className="flex-1 items-center justify-center px-8">
              <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-8 max-w-sm w-full items-center">
                <Text className="text-white font-instrument-semibold text-xl mb-2 text-center">
                  Select a conversation
                </Text>
                <Text className="text-gray-400 font-instrument text-center">
                  Choose a thread from the list to view messages and reply.
                </Text>
              </View>
            </View>
          )}
        </View>
        </View>

        {/* Reply composer: right-side panel (slides in, pushes content left) */}
        {showReplyComposer && (
          <Animated.View
            style={{
              width: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [REPLY_PANEL_WIDTH, 0],
              }),
              overflow: 'hidden',
              backgroundColor: '#1A1A1A',
              borderLeftWidth: 1,
              borderLeftColor: '#2A2A2A',
            }}
          >
            <View style={{ width: REPLY_PANEL_WIDTH, flex: 1 }}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
              >
                <View className="flex-1 p-5">
                  <View className="flex-row justify-between items-center mb-5 pb-3 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
                    <Text className="text-xl font-instrument-semibold text-white">Reply</Text>
                    <Pressable
                      onPress={closeReplyPanel}
                      className="rounded-xl border border-[#3A3A3A] px-4 py-2"
                    >
                      <Text className="text-gray-300 font-instrument-medium text-sm">Cancel</Text>
                    </Pressable>
                  </View>
                  {replyError && (
                    <Alert variant="error" message={replyError} className="mb-4" />
                  )}
                  <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} className="flex-1 pb-4">
                    <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">To</Text>
                    <TextInput
                      value={replyToEmail}
                      onChangeText={setReplyToEmail}
                      placeholder="recipient@example.com"
                      placeholderTextColor="#6B7280"
                      className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                      style={{ borderWidth: 1 }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                    <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Cc (optional)</Text>
                    <Text className="text-gray-500 font-instrument text-xs mb-1">Separate multiple addresses with commas or spaces.</Text>
                    <TextInput
                      value={replyCc}
                      onChangeText={setReplyCc}
                      placeholder="cc@example.com, other@example.com"
                      placeholderTextColor="#6B7280"
                      className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                      style={{ borderWidth: 1 }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                    <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Subject</Text>
                    <TextInput
                      value={replySubject}
                      onChangeText={setReplySubject}
                      placeholder="Subject"
                      placeholderTextColor="#6B7280"
                      className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                      style={{ borderWidth: 1 }}
                    />
                    <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Message</Text>
                    <TextInput
                      value={replyBody}
                      onChangeText={setReplyBody}
                      placeholder="Write your reply…"
                      placeholderTextColor="#6B7280"
                      className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-5 min-h-[120px] border border-[#2A2A2A]"
                      style={{ borderWidth: 1 }}
                      multiline
                      textAlignVertical="top"
                    />
                    <Button
                      onPress={sendReply}
                      disabled={sendingReply || !replyToEmail.trim()}
                      className="rounded-xl"
                    >
                      {sendingReply ? 'Sending…' : 'Send reply'}
                    </Button>
                  </ScrollView>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Animated.View>
        )}
      </View>
    </PageLayout>
  );
}
