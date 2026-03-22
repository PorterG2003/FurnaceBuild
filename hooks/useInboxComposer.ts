import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import {
  createReplyJob,
  createForwardJob,
  getMessageJobStatus,
  getPendingInboxReplyJobs,
  getMessagesByThread,
  isEmailBlockedByEntries,
} from '@/lib/supabase/services';
import type { EmailMessage } from '@/lib/supabase/types';
import type { BlockListEntry } from '@/lib/supabase/types';
import type { EmailThread } from '@/lib/supabase/types';
import type { EditorBridge } from '@10play/tentap-editor';
import type { ComposerAttachmentItem } from '@/components/inbox';
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MAX_FILE_BYTES } from '@/components/inbox/inboxConstants';

export type PendingReply = {
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
  attachments?: Array<{ filename: string; contentType: string; content: string }>;
};

export interface UseInboxComposerOptions {
  accountId: string | null;
  selectedThreadId: string | null;
  selectedThread: EmailThread | undefined;
  messages: EmailMessage[];
  loadMessages: (threadId: string, options?: { silent?: boolean }) => void;
  blockList: BlockListEntry[];
  toast: { error: (message: string) => void };
  setBlockedRecipientConfirm: (value: { mode: 'reply' | 'forward'; onConfirm: () => void } | null) => void;
  threadsLoading?: boolean;
}

export function useInboxComposer({
  accountId,
  selectedThreadId,
  selectedThread,
  messages,
  loadMessages,
  blockList,
  toast,
  setBlockedRecipientConfirm,
  threadsLoading = false,
}: UseInboxComposerOptions) {
  const [composerMode, setComposerMode] = useState<'reply' | 'forward' | null>(null);
  const [inReplyToMessageId, setInReplyToMessageId] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState('');
  const [replyToName, setReplyToName] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const [forwardedMessageId, setForwardedMessageId] = useState<string | null>(null);
  const [forwardToEmail, setForwardToEmail] = useState('');
  const [forwardCc, setForwardCc] = useState('');
  const [forwardSubject, setForwardSubject] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [sendingForward, setSendingForward] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachmentItem[]>([]);
  const [composerAttachmentsLoading, setComposerAttachmentsLoading] = useState(false);
  const [composerAttachmentsSkipMessage, setComposerAttachmentsSkipMessage] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);

  const composerEditorRef = useRef<EditorBridge | null>(null);
  const slideAnim = useRef(new Animated.Value(1)).current;
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const closeComposerPanel = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setComposerMode(null);
      setComposerAttachments([]);
      setComposerAttachmentsSkipMessage(null);
    });
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
    if (!pendingReply.isFailed && messages.length > pendingReply.messageCountWhenPending) {
      setPendingReply(null);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [pendingReply, selectedThreadId, messages.length]);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  // Restore pending reply from database when thread is selected and threads have loaded
  useEffect(() => {
    if (!accountId || !selectedThreadId || threadsLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const pendingJobs = await getPendingInboxReplyJobs(accountId);
        if (cancelled) return;
        const jobForThread = pendingJobs.find((j) => j.thread_id === selectedThreadId);
        if (!jobForThread) return;

        const threadMessages = await getMessagesByThread(selectedThreadId);
        if (cancelled) return;
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
          receivedAt: new Date().toISOString(),
          messageCountWhenPending: threadMessages.length,
          errorMessage: jobForThread.error_message,
          isFailed: jobForThread.status === 'failed',
          inReplyToMessageId: jobForThread.message_data.in_reply_to_message_id,
          attachments: jobForThread.message_data.attachments,
        });

        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        const jobIdToPoll = jobForThread.id;
        pollingIntervalRef.current = setInterval(async () => {
          loadMessages(selectedThreadId, { silent: true });
          try {
            const jobStatus = await getMessageJobStatus(jobIdToPoll);
            if (jobStatus?.status === 'failed') {
              setPendingReply((prev) =>
                prev && prev.jobId === jobIdToPoll
                  ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                  : prev
              );
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            }
          } catch (err) {
            console.error('Failed to check job status:', err);
          }
        }, 2000);
      } catch (err) {
        console.error('Failed to restore pending reply:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, selectedThreadId, threadsLoading, loadMessages]);

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
      setComposerMode('forward');
    },
    [selectedThread]
  );

  const retryFailedReply = useCallback(async () => {
    if (!accountId || !selectedThreadId || !selectedThread || !pendingReply || !pendingReply.isFailed) return;
    setSendingReply(true);
    try {
      const replyAttachments = pendingReply.attachments?.length
        ? pendingReply.attachments.map(({ filename, contentType, content }) => ({ filename, contentType, content }))
        : undefined;
      const jobId = await createReplyJob({
        accountId,
        threadId: selectedThreadId,
        inReplyToMessageId: inReplyToMessageId!,
        subject: pendingReply.subject,
        bodyText: pendingReply.bodyText,
        bodyHtml: pendingReply.bodyHtml ?? pendingReply.bodyText,
        toEmail: pendingReply.toEmail,
        toName: pendingReply.toName ?? null,
        cc: pendingReply.cc?.length ? pendingReply.cc : undefined,
        attachments: replyAttachments,
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
        attachments: pendingReply.attachments,
      });
      loadMessages(selectedThreadId);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      pollingIntervalRef.current = setInterval(async () => {
        loadMessages(selectedThreadId, { silent: true });
        try {
          const jobStatus = await getMessageJobStatus(jobId);
          if (jobStatus?.status === 'failed') {
            setPendingReply((prev) =>
              prev && prev.jobId === jobId
                ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                : prev
            );
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
        } catch (err) {
          console.error('Failed to check job status:', err);
        }
      }, 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to retry reply');
    } finally {
      setSendingReply(false);
    }
  }, [accountId, selectedThreadId, selectedThread, pendingReply, messages, loadMessages, toast, inReplyToMessageId]);

  const sendReply = useCallback(
    async (skipBlockCheck?: boolean) => {
      if (!accountId || !selectedThreadId || !selectedThread || !inReplyToMessageId) return;
      if (!replyToEmail.trim()) {
        toast.error('To is required');
        return;
      }
      const totalAttachmentBytes = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
      if (totalAttachmentBytes > MAX_TOTAL_BYTES) {
        toast.error('Total attachment size exceeds 5 MB.');
        return;
      }
      const ccArray = replyCc.trim() ? replyCc.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) : [];
      const allRecipients = [replyToEmail.trim(), ...ccArray];
      if (!skipBlockCheck && blockList.length > 0) {
        const anyBlocked = allRecipients.some((email) => isEmailBlockedByEntries(email, blockList));
        if (anyBlocked) {
          setBlockedRecipientConfirm({
            mode: 'reply',
            onConfirm: () => sendReply(true),
          });
          return;
        }
      }
      setSendingReply(true);
      try {
        const bodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
        const bodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? bodyText;
        const replyAttachments =
          composerAttachments.length > 0
            ? composerAttachments.map(({ filename, contentType, content }) => ({ filename, contentType, content }))
            : undefined;
        const jobId = await createReplyJob({
          accountId,
          threadId: selectedThreadId,
          inReplyToMessageId,
          subject: replySubject.trim() || '(No subject)',
          bodyText: bodyText || '',
          bodyHtml: bodyHtml || '',
          toEmail: replyToEmail.trim(),
          toName: replyToName.trim() || null,
          cc: ccArray.length > 0 ? ccArray : undefined,
          attachments: replyAttachments,
        });
        const fromEmail = messages.find((m) => m.direction === 'sent')?.from_email ?? '';
        const receivedAt = new Date().toISOString();
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
          attachments: replyAttachments,
        });
        closeComposerPanel();
        loadMessages(selectedThreadId);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        pollingIntervalRef.current = setInterval(async () => {
          loadMessages(selectedThreadId, { silent: true });
          try {
            const jobStatus = await getMessageJobStatus(jobId);
            if (jobStatus?.status === 'failed') {
              setPendingReply((prev) =>
                prev && prev.jobId === jobId
                  ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                  : prev
              );
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            }
          } catch (err) {
            console.error('Failed to check job status:', err);
          }
        }, 2000);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send reply');
      } finally {
        setSendingReply(false);
      }
    },
    [
      accountId,
      selectedThreadId,
      selectedThread,
      inReplyToMessageId,
      replyToEmail,
      replyToName,
      replySubject,
      replyCc,
      composerAttachments,
      messages,
      blockList,
      loadMessages,
      closeComposerPanel,
      toast,
      setBlockedRecipientConfirm,
    ]
  );

  const sendForward = useCallback(
    async (skipBlockCheck?: boolean) => {
      if (!accountId || !selectedThreadId || !selectedThread || !forwardedMessageId) return;
      if (!forwardToEmail.trim()) {
        toast.error('To is required');
        return;
      }
      const totalAttachmentBytes = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
      if (totalAttachmentBytes > MAX_TOTAL_BYTES) {
        toast.error('Total attachment size exceeds 5 MB.');
        return;
      }
      const ccArray = forwardCc.trim() ? forwardCc.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) : [];
      const allRecipients = [forwardToEmail.trim(), ...ccArray];
      if (!skipBlockCheck && blockList.length > 0) {
        const anyBlocked = allRecipients.some((email) => isEmailBlockedByEntries(email, blockList));
        if (anyBlocked) {
          setBlockedRecipientConfirm({
            mode: 'forward',
            onConfirm: () => sendForward(true),
          });
          return;
        }
      }
      setSendingForward(true);
      try {
        const bodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
        const bodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? bodyText;
        const forwardAttachments =
          composerAttachments.length > 0
            ? composerAttachments.map(({ filename, contentType, content }) => ({ filename, contentType, content }))
            : undefined;
        await createForwardJob({
          accountId,
          threadId: selectedThreadId,
          forwardedMessageId,
          subject: forwardSubject.trim() || '(No subject)',
          bodyText: bodyText || '',
          bodyHtml: bodyHtml || bodyText,
          toEmail: forwardToEmail.trim(),
          toName: null,
          cc: ccArray.length > 0 ? ccArray : undefined,
          attachments: forwardAttachments,
        });
        closeComposerPanel();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send forward');
      } finally {
        setSendingForward(false);
      }
    },
    [
      accountId,
      selectedThreadId,
      selectedThread,
      forwardedMessageId,
      forwardToEmail,
      forwardSubject,
      forwardCc,
      composerAttachments,
      blockList,
      closeComposerPanel,
      toast,
      setBlockedRecipientConfirm,
    ]
  );

  const handleComposerFilesSelected = useCallback(
    async (files: FileList) => {
      if (!files?.length) return;
      setComposerAttachmentsLoading(true);
      setComposerAttachmentsSkipMessage(null);
      const toAdd: ComposerAttachmentItem[] = [];
      let skippedTooBig = 0;
      let skippedTotal = 0;
      let skippedCount = 0;
      let skippedOther = 0;
      const currentTotal = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
      for (let i = 0; i < files.length; i++) {
        if (composerAttachments.length + toAdd.length >= MAX_ATTACHMENTS) {
          skippedCount += files.length - i;
          break;
        }
        const file = files[i];
        if (file.size > MAX_FILE_BYTES) {
          skippedTooBig += 1;
          continue;
        }
        const runningTotal = currentTotal + toAdd.reduce((s, a) => s + (a.size ?? 0), 0);
        if (runningTotal + file.size > MAX_TOTAL_BYTES) {
          skippedTotal += 1;
          continue;
        }
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const match = result?.match(/^data:([^;]+);base64,(.+)$/);
              if (match) resolve(match[2]);
              else reject(new Error('Invalid data URL'));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          toAdd.push({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            content: base64,
            size: file.size,
          });
        } catch {
          skippedOther += 1;
        }
      }
      setComposerAttachmentsLoading(false);
      if (toAdd.length > 0) {
        setComposerAttachments((prev) => [...prev, ...toAdd]);
      }
      const skippedTotalCount = skippedTooBig + skippedTotal + skippedCount + skippedOther;
      if (skippedTotalCount > 0) {
        const parts: string[] = [];
        if (skippedTooBig > 0) parts.push(`${skippedTooBig} over 2 MB`);
        if (skippedTotal > 0) parts.push(`${skippedTotal} would exceed 5 MB total`);
        if (skippedCount > 0) parts.push(`${skippedCount} over 10 file limit`);
        if (skippedOther > 0) parts.push(`${skippedOther} could not be read`);
        setComposerAttachmentsSkipMessage(
          toAdd.length > 0
            ? `${skippedTotalCount} file${skippedTotalCount !== 1 ? 's' : ''} skipped (${parts.join(', ')})`
            : `No files added. ${skippedTotalCount} file${skippedTotalCount !== 1 ? 's' : ''} skipped (${parts.join(', ')})`
        );
      }
    },
    [composerAttachments]
  );

  return {
    composerMode,
    setComposerMode,
    inReplyToMessageId,
    setInReplyToMessageId,
    replyToEmail,
    setReplyToEmail,
    replyToName,
    setReplyToName,
    replySubject,
    setReplySubject,
    replyCc,
    setReplyCc,
    forwardedMessageId,
    setForwardedMessageId,
    forwardToEmail,
    setForwardToEmail,
    forwardCc,
    setForwardCc,
    forwardSubject,
    setForwardSubject,
    sendingReply,
    sendingForward,
    composerAttachments,
    setComposerAttachments,
    composerAttachmentsLoading,
    composerAttachmentsSkipMessage,
    pendingReply,
    setPendingReply,
    composerEditorRef,
    slideAnim,
    closeComposerPanel,
    openReplyComposer,
    openForwardComposer,
    sendReply,
    sendForward,
    retryFailedReply,
    handleComposerFilesSelected,
  };
}
