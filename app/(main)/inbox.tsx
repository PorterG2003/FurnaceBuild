import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { EmptyState, Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import {
  getAccountMembershipsForUser,
  getThreadsByAccount,
  getMessagesByThread,
  getUserByExternalId,
  createReplyJob,
  createForwardJob,
  getMessageJobStatus,
  getPendingInboxReplyJobs,
  fetchAttachment,
} from '@/lib/supabase/services';
import type { EmailThread, EmailMessage } from '@/lib/supabase/types';
import { groupMessagesByDate } from '@/lib/inbox';
import { buildQuotedForwardThreadHtml } from '@/lib/inbox/quote-utils';
import { MagnifyingGlassIcon, PaperAirplaneIcon } from 'react-native-heroicons/outline';
import type { EditorBridge } from '@10play/tentap-editor';
import {
  ComposerRichEditor,
  DateDivider,
  MessageBubble,
  MessagePanelHeader,
  MessagePanelHeaderSkeleton,
  MessageListSkeleton,
  ThreadItem,
  ThreadListSkeleton,
  SKELETON_DELAY_MS,
  SKELETON_MIN_DISPLAY_MS,
} from '@/components/inbox';
import { fetchAuthSession } from 'aws-amplify/auth';
import outputs from '@/amplify_outputs.json';

const FETCH_ATTACHMENT_URL = (outputs as { custom?: { fetchEmailAttachmentUrl?: string } }).custom?.fetchEmailAttachmentUrl;

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
  const [composerMode, setComposerMode] = useState<'reply' | 'forward' | null>(null);
  const [inReplyToMessageId, setInReplyToMessageId] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState('');
  const [replyToName, setReplyToName] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const composerEditorRef = useRef<EditorBridge | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [forwardedMessageId, setForwardedMessageId] = useState<string | null>(null);
  const [forwardToEmail, setForwardToEmail] = useState('');
  const [forwardCc, setForwardCc] = useState('');
  const [forwardSubject, setForwardSubject] = useState('');
  const [sendingForward, setSendingForward] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);

  const [showThreadSkeleton, setShowThreadSkeleton] = useState(false);
  const [showMessagesSkeleton, setShowMessagesSkeleton] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');

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
  const lastContentHeightRef = useRef(0);
  const prevMessagesLengthRef = useRef(0);
  const prevSelectedThreadIdRef = useRef<string | null>(null);
  const autoScrollArmedRef = useRef(false);
  const selectedThreadIdRef = useRef(selectedThreadId);
  selectedThreadIdRef.current = selectedThreadId;

  const threadSkeletonTimers = useRef<{ show: ReturnType<typeof setTimeout> | null; hide: ReturnType<typeof setTimeout> | null }>({ show: null, hide: null });
  const messagesSkeletonTimers = useRef<{ show: ReturnType<typeof setTimeout> | null; hide: ReturnType<typeof setTimeout> | null }>({ show: null, hide: null });

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const threadsLoadingOrNoAccount = threadsLoading || !accountId;

  const filteredThreads = useMemo(() => {
    const q = threadSearchQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((thread) => {
      const subjectMatch = (thread.subject ?? '').toLowerCase().includes(q);
      const participantsMatch = (thread.participants ?? []).some((p) =>
        p.toLowerCase().includes(q)
      );
      return subjectMatch || participantsMatch;
    });
  }, [threads, threadSearchQuery]);

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
      } else {
        const current = selectedThreadIdRef.current;
        if (!current || !list.some((t) => t.id === current)) {
          setSelectedThreadId(list[0].id);
        }
      }
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setThreadsLoading(false);
    }
  }, [accountId]);

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

  const scrollMessagesToEnd = useCallback((reason: string, nextHeight?: number) => {
    if (typeof nextHeight === 'number') {
      lastContentHeightRef.current = nextHeight;
    }
    messagesScrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  useEffect(() => {
    const previousThreadId = prevSelectedThreadIdRef.current;
    const previousLength = prevMessagesLengthRef.current;
    const threadChanged = previousThreadId !== selectedThreadId;
    const messagesIncreased = messages.length > previousLength;
    if (threadChanged || messagesIncreased) {
      autoScrollArmedRef.current = true;
    }
    prevMessagesLengthRef.current = messages.length;
    prevSelectedThreadIdRef.current = selectedThreadId;
  }, [messages.length, selectedThreadId, pendingReply, composerMode]);

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
      setComposerMode('reply');
    },
    [selectedThread, messages]
  );

  const openForwardComposer = useCallback(
    (_message: EmailMessage) => {
      if (!selectedThread) return;
      const subject = selectedThread.subject ?? '(No subject)';
      const fwdSubject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
      setForwardedMessageId(_message.id);
      setForwardToEmail('');
      setForwardCc('');
      setForwardSubject(fwdSubject);
      setForwardError(null);
      setComposerMode('forward');
    },
    [selectedThread]
  );

  const handleFetchAttachmentBlob = useCallback(
    async (emailMessageId: string, part: string): Promise<Blob | null> => {
      if (!FETCH_ATTACHMENT_URL) return null;
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (!token) return null;
        return await fetchAttachment(FETCH_ATTACHMENT_URL, token, emailMessageId, part);
      } catch {
        return null;
      }
    },
    []
  );

  const handleDownloadAttachment = useCallback(
    async (emailMessageId: string, part: string, filename: string) => {
      const blob = await handleFetchAttachmentBlob(emailMessageId, part);
      if (!blob) return;
      try {
        if (Platform.OS === 'web') {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename || 'attachment';
          a.click();
          URL.revokeObjectURL(url);
        } else {
          // Native: download not yet implemented (web only for now)
          // TODO: Add expo-file-system + expo-sharing for native save/share
        }
      } catch (err) {
        console.error('Download attachment failed:', err);
      }
    },
    [handleFetchAttachmentBlob]
  );

  const winWidth = Dimensions.get('window').width;
  const REPLY_PANEL_WIDTH = Math.min(800, Math.max(520, winWidth * 0.58));
  const slideAnim = useRef(new Animated.Value(1)).current;

  const closeComposerPanel = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setComposerMode(null));
  }, [slideAnim]);

  useEffect(() => {
    if (composerMode) {
      slideAnim.setValue(1);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    }
  }, [composerMode, slideAnim]);

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
        toName: pendingReply.toName ?? null,
        cc: pendingReply.cc?.length ? pendingReply.cc : undefined,
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
      const bodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
      const bodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? bodyText;
      const jobId = await createReplyJob({
        accountId,
        threadId: selectedThreadId,
        inReplyToMessageId,
        subject: replySubject.trim() || '(No subject)',
        bodyText: bodyText || '',
        bodyHtml: bodyHtml || '',
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
        bodyText: bodyText || '',
        bodyHtml: bodyHtml || '',
        toEmail: replyToEmail.trim(),
        toName: replyToName.trim() || null,
        cc: ccArray,
        fromEmail,
        receivedAt,
        messageCountWhenPending: messages.length,
        inReplyToMessageId,
      });
      closeComposerPanel();
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
  }, [accountId, selectedThreadId, selectedThread, inReplyToMessageId, replyToEmail, replyToName, replySubject, replyCc, messages, loadMessages, closeComposerPanel]);

  const sendForward = useCallback(async () => {
    if (!accountId || !selectedThreadId || !selectedThread || !forwardedMessageId) return;
    if (!forwardToEmail.trim()) {
      setForwardError('To is required');
      return;
    }
    setSendingForward(true);
    setForwardError(null);
    try {
      const bodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
      const bodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? bodyText;

      await createForwardJob({
        accountId,
        threadId: selectedThreadId,
        forwardedMessageId,
        subject: forwardSubject.trim() || '(No subject)',
        bodyText: bodyText || '',
        bodyHtml: bodyHtml || bodyText,
        toEmail: forwardToEmail.trim(),
        toName: null,
        cc: forwardCc.trim() ? forwardCc.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) : undefined,
      });
      closeComposerPanel();
    } catch (err) {
      setForwardError(err instanceof Error ? err.message : 'Failed to send forward');
    } finally {
      setSendingForward(false);
    }
  }, [accountId, selectedThreadId, selectedThread, forwardedMessageId, forwardToEmail, forwardSubject, forwardCc, closeComposerPanel]);

  return (
    <PageLayout scrollable={false}>
      <View className="flex-1 flex-row bg-[#121212]">
        {/* Threads + Message content (slides left when reply panel opens) */}
        <View style={{ flex: 1, minWidth: 0 }} className="flex-row">
        {/* Threads Panel - collapses when reply/forward panel is open */}
        <Animated.View
          className="border-r border-[#2A2A2A] bg-[#0D0D0D]"
          style={{
            width: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 384] }),
            overflow: 'hidden',
            borderRightWidth: 1,
          }}
        >
          <View className="px-4 py-4 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
            <View className="flex-row items-center rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] px-3 py-2.5" style={{ borderWidth: 1 }}>
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
            {!threadsLoadingOrNoAccount && !showThreadSkeleton && threads.length > 0 && (
              <Text className="text-gray-500 font-instrument text-xs mt-2">
                {threadSearchQuery.trim()
                  ? `${filteredThreads.length} of ${threads.length}`
                  : `${threads.length} conversation${threads.length !== 1 ? 's' : ''}`}
              </Text>
            )}
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
          ) : filteredThreads.length === 0 ? (
            <EmptyState
              title="No matching conversations"
              description="Try a different search term."
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
              {filteredThreads.map((thread) => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  isSelected={selectedThreadId === thread.id}
                  onSelect={() => setSelectedThreadId(thread.id)}
                />
              ))}
            </ScrollView>
          )}
        </Animated.View>

        {/* Message Panel */}
        <View className="flex-1">
          {(threadsLoadingOrNoAccount || showThreadSkeleton) ? (
            <>
              <MessagePanelHeaderSkeleton />
              <MessageListSkeleton />
            </>
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
                  onContentSizeChange={(_w, h) => {
                    const shouldAutoScroll = autoScrollArmedRef.current;
                    if (shouldAutoScroll) {
                      autoScrollArmedRef.current = false;
                      scrollMessagesToEnd('content-size-change', h);
                      return;
                    }
                    if (lastContentHeightRef.current !== h) {
                      lastContentHeightRef.current = h;
                    }
                  }}
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
                            onForward={openForwardComposer}
                            onDownloadAttachment={FETCH_ATTACHMENT_URL ? handleDownloadAttachment : undefined}
                            onFetchAttachmentPreview={FETCH_ATTACHMENT_URL ? handleFetchAttachmentBlob : undefined}
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

        {/* Reply/Forward composer: right-side panel (slides in, pushes content left) */}
        {composerMode && (
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
                    <Text className="text-xl font-instrument-semibold text-white">
                      {composerMode === 'reply' ? 'Reply' : 'Forward'}
                    </Text>
                    <Pressable
                      onPress={closeComposerPanel}
                      className="rounded-xl border border-[#3A3A3A] px-4 py-2"
                    >
                      <Text className="text-gray-300 font-instrument-medium text-sm">Cancel</Text>
                    </Pressable>
                  </View>
                  {composerMode === 'reply' ? (
                    <>
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
                        <ComposerRichEditor
                          key="reply"
                          initialContent="<p></p>"
                          placeholder="Write your reply…"
                          editorRef={composerEditorRef}
                          minHeight={140}
                        />
                        <View className="mb-5" />
                        <Button
                          onPress={sendReply}
                          disabled={sendingReply || !replyToEmail.trim()}
                          className="rounded-xl"
                        >
                          <View className="flex-row items-center gap-2">
                            <Text className="font-instrument-medium text-base text-white">
                              {sendingReply ? 'Sending…' : 'Send reply'}
                            </Text>
                            <PaperAirplaneIcon size={18} color="white" />
                          </View>
                        </Button>
                      </ScrollView>
                    </>
                  ) : (
                    <>
                      {forwardError && (
                        <Alert variant="error" message={forwardError} className="mb-4" />
                      )}
                      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} className="flex-1 pb-4">
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">To</Text>
                        <TextInput
                          value={forwardToEmail}
                          onChangeText={setForwardToEmail}
                          placeholder="recipient@example.com"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Cc (optional)</Text>
                        <TextInput
                          value={forwardCc}
                          onChangeText={setForwardCc}
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
                          value={forwardSubject}
                          onChangeText={setForwardSubject}
                          placeholder="Subject"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Message</Text>
                        <Text className="text-gray-500 font-instrument text-xs mb-1">Add your message above the forwarded content.</Text>
                        <ComposerRichEditor
                          key="forward"
                          initialContent={`<p></p>${buildQuotedForwardThreadHtml(messages, selectedThread?.subject ?? '(No subject)')}`}
                          placeholder="Write your message…"
                          editorRef={composerEditorRef}
                          minHeight={140}
                        />
                        <View className="mb-5" />
                        <Button
                          onPress={sendForward}
                          disabled={sendingForward || !forwardToEmail.trim()}
                          className="rounded-xl"
                        >
                          <View className="flex-row items-center gap-2">
                            <Text className="font-instrument-medium text-base text-white">
                              {sendingForward ? 'Sending…' : 'Send forward'}
                            </Text>
                            <PaperAirplaneIcon size={18} color="white" />
                          </View>
                        </Button>
                      </ScrollView>
                    </>
                  )}
                </View>
              </KeyboardAvoidingView>
            </View>
          </Animated.View>
        )}
      </View>
    </PageLayout>
  );
}
