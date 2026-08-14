import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { mergeInboxComposeHtml } from '@/lib/email/buildCampaignEmailContent';
import {
  buildForwardDefaultSubject,
  buildReplyDefaultSubject,
  canonicalizeEmailContentForSave,
  convertHtmlToRichTextSeed,
  mergeHtmlEmailWithSignature,
  seedHtmlModeFromRichText,
  stripHtml,
  type EmailEditorMode,
} from '@/lib/email';
import {
  buildInteractionIntent,
  buildForwardComposerHtml,
  buildForwardedConversationHtml,
  detectSuggestedReplyUsage,
  renderPendingCampaignReplyContent,
} from '@/lib/inbox';
import { resolveReplyComposerTarget } from '@/lib/inbox/resolveReplyComposerTarget';
import { parseSmartHandlingMetadata } from '@/lib/inbox/smartHandling';
import {
  cancelPendingOutboundJob,
  createReplyJob,
  createForwardJob,
  getMessageJobStatus,
  getPendingCampaignReplyJobs,
  getPendingInboxManualJobs,
  getThreadAutoReplyPipelineState,
  isEmailBlockedByEntries,
  requestImmediateManualSend,
  type PendingCampaignReplyJob,
  type PendingInboxManualJob,
  type ThreadAutoReplyPipelineState,
} from '@/lib/supabase/services';
import type { EmailMessage } from '@/lib/supabase/types';
import type { BlockListEntry } from '@/lib/supabase/types';
import type { EmailThread } from '@/lib/supabase/types';
import type { EditorBridge } from '@10play/tentap-editor';
import type { ComposerAttachmentItem } from '@/components/inbox';
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MAX_FILE_BYTES } from '@/components/inbox/inboxConstants';
import { useInboxInteractionSession } from '@/contexts/InboxInteractionContext';
import {
  deleteAttachmentUpload,
  prepareAttachmentUpload,
  uploadToSignedUrl,
} from '@/lib/services/attachments';
import { getAccessToken } from '@/lib/services/auth-token';
import outputs from '@/amplify_outputs.json';

const FETCH_ATTACHMENT_URL = (outputs as { custom?: { fetchEmailAttachmentUrl?: string } }).custom
  ?.fetchEmailAttachmentUrl;

export type PendingReply = {
  kind: 'reply' | 'forward' | 'campaign_priority';
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
  errorMessage?: string | null;
  isFailed?: boolean;
  jobStatus: 'queued' | 'reserved' | 'sending' | 'failed';
  scheduledAt: string | null;
  sendWaitReason: string | null;
  throttleBypassNextAttempt: boolean;
  isSendingImmediately?: boolean;
  campaignId?: string;
  inReplyToMessageId?: string;
  forwardedMessageId?: string;
  attachments?: Array<{ filename: string; contentType: string; size: number; storagePath: string }>;
};

export type ReplyDuplicateConfirmState = {
  title: string;
  message: string;
  onConfirm: () => void;
} | null;

export interface ForwardComposerPrefill {
  toEmail?: string | null;
  toName?: string | null;
}

export interface UseInboxComposerOptions {
  accountId: string | null;
  mailboxSignatureRaw: string | null;
  selectedThreadId: string | null;
  selectedThread: EmailThread | undefined;
  currentLeadEmail?: string | null;
  currentLeadName?: string | null;
  messages: EmailMessage[];
  loadMessages: (threadId: string, options?: { silent?: boolean; force?: boolean }) => void;
  blockList: BlockListEntry[];
  toast: { error: (message: string) => void; success: (message: string) => void };
  setBlockedRecipientConfirm: (value: { mode: 'reply' | 'forward'; onConfirm: () => void } | null) => void;
  threadsLoading?: boolean;
}

function jobToPendingReply(job: PendingInboxManualJob, fromEmail: string): PendingReply {
  return {
    kind: job.message_data.source === 'inbox_forward' ? 'forward' : 'reply',
    threadId: job.thread_id,
    jobId: job.id,
    subject: job.message_data.subject,
    bodyText: job.message_data.body_text,
    bodyHtml: job.message_data.body_html,
    toEmail: job.message_data.to_email,
    toName: job.message_data.to_name || null,
    cc: job.message_data.cc || [],
    fromEmail,
    receivedAt: job.created_at,
    errorMessage: job.error_message,
    isFailed: job.status === 'failed',
    jobStatus: job.status,
    scheduledAt: job.scheduled_at,
    sendWaitReason: job.send_wait_reason,
    throttleBypassNextAttempt: job.throttle_bypass_next_attempt,
    inReplyToMessageId: job.message_data.in_reply_to_message_id,
    forwardedMessageId: job.message_data.forwarded_message_id,
    attachments: job.message_data.attachments,
  };
}

function jobToPendingCampaignReply(
  job: PendingCampaignReplyJob,
  fromEmail: string,
  mailboxSignatureRaw: string | null
): PendingReply {
  const preview = renderPendingCampaignReplyContent({
    messageData: job.message_data,
    mailboxSignature: mailboxSignatureRaw,
  });
  return {
    kind: 'campaign_priority',
    threadId: job.thread_id,
    jobId: job.id,
    subject: job.message_data.subject,
    bodyText: preview.bodyText,
    bodyHtml: preview.bodyHtml ?? preview.bodyText,
    toEmail: job.message_data.to_email,
    toName: job.message_data.to_name || null,
    cc: [],
    fromEmail,
    receivedAt: job.created_at,
    errorMessage: job.error_message,
    isFailed: job.status === 'failed',
    jobStatus: job.status,
    scheduledAt: job.scheduled_at,
    sendWaitReason: job.send_wait_reason,
    throttleBypassNextAttempt: job.throttle_bypass_next_attempt,
    campaignId: job.campaign_id,
  };
}

export function useInboxComposer({
  accountId,
  mailboxSignatureRaw,
  selectedThreadId,
  selectedThread,
  currentLeadEmail = null,
  currentLeadName = null,
  messages,
  loadMessages,
  blockList,
  toast,
  setBlockedRecipientConfirm,
  threadsLoading = false,
}: UseInboxComposerOptions) {
  const interactionSession = useInboxInteractionSession();
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
  const [pendingReplies, setPendingReplies] = useState<PendingReply[]>([]);
  const [autoReplyPipelineState, setAutoReplyPipelineState] =
    useState<ThreadAutoReplyPipelineState | null>(null);
  const [replyDuplicateConfirm, setReplyDuplicateConfirm] =
    useState<ReplyDuplicateConfirmState>(null);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [forwardQuoteHtml, setForwardQuoteHtml] = useState('');
  const [replyEditorMode, setReplyEditorMode] = useState<EmailEditorMode>('richText');
  const [forwardEditorMode, setForwardEditorMode] = useState<EmailEditorMode>('richText');
  const [replyHtmlDraft, setReplyHtmlDraft] = useState('');
  const [forwardHtmlDraft, setForwardHtmlDraft] = useState('');
  const [replyRichInitialContent, setReplyRichInitialContent] = useState('<p></p>');
  const [forwardRichInitialContent, setForwardRichInitialContent] = useState('<p></p>');
  const [switchToRichConfirmMode, setSwitchToRichConfirmMode] = useState<'reply' | 'forward' | null>(null);
  const [, setSendImmediatelyJobId] = useState<string | null>(null);

  const composerEditorRef = useRef<EditorBridge | null>(null);
  const slideAnim = useRef(new Animated.Value(1)).current;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRepliesRef = useRef<PendingReply[]>([]);

  useEffect(() => {
    pendingRepliesRef.current = pendingReplies;
  }, [pendingReplies]);

  const closeComposerPanel = useCallback(() => {
    interactionSession.setComposerIntent(null);
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setComposerMode(null);
      setComposerAttachments([]);
      setComposerAttachmentsSkipMessage(null);
      setIncludeSignature(true);
      setForwardQuoteHtml('');
      setReplyEditorMode('richText');
      setForwardEditorMode('richText');
      setReplyHtmlDraft('');
      setForwardHtmlDraft('');
      setReplyRichInitialContent('<p></p>');
      setForwardRichInitialContent('<p></p>');
      setSwitchToRichConfirmMode(null);
      setReplyDuplicateConfirm(null);
    });
  }, [interactionSession, slideAnim]);

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
    setPendingReplies([]);
    setAutoReplyPipelineState(null);
    setReplyDuplicateConfirm(null);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    setPendingReplies((prev) => {
      const next = prev.filter((p) => {
        if (p.threadId !== selectedThreadId) return true;
        const delivered = messages.some(
          (m) => m.thread_id === selectedThreadId && m.message_job_id === p.jobId
        );
        return !delivered;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [messages, selectedThreadId]);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedThreadId || threadsLoading) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const tid = selectedThreadId;

    const tick = async () => {
      const list = pendingRepliesRef.current.filter((p) => p.threadId === tid);
      if (list.length === 0) return;

      loadMessages(tid, { silent: true });

      for (const p of list) {
        try {
          const jobStatus = await getMessageJobStatus(p.jobId);
          if (!jobStatus) continue;
          if (jobStatus.status === 'failed') {
            setPendingReplies((prev) =>
              prev.map((x) =>
                x.jobId === p.jobId
                  ? {
                      ...x,
                      isFailed: true,
                      errorMessage: jobStatus.error_message,
                      jobStatus: 'failed',
                      scheduledAt: jobStatus.scheduled_at,
                      sendWaitReason: jobStatus.send_wait_reason,
                      throttleBypassNextAttempt: jobStatus.throttle_bypass_next_attempt,
                    }
                  : x
              )
            );
          } else if (
            jobStatus.status === 'sent' ||
            jobStatus.status === 'cancelled' ||
            jobStatus.status === 'blocked'
          ) {
            if (p.kind === 'forward') {
              if (jobStatus.status === 'sent') {
                toast.success(`Forwarded to ${p.toEmail}`);
              } else {
                toast.error(
                  jobStatus.error_message ??
                    (jobStatus.status === 'blocked'
                      ? 'Forward was blocked and did not send.'
                      : 'Forward was cancelled and did not send.')
                );
              }
            }
            setPendingReplies((prev) => prev.filter((x) => x.jobId !== p.jobId));
          } else {
            setPendingReplies((prev) =>
              prev.map((x) =>
                x.jobId === p.jobId
                  ? (() => {
                      const nextStatus: PendingReply['jobStatus'] =
                        jobStatus.status === 'sending' ||
                        jobStatus.status === 'reserved' ||
                        jobStatus.status === 'queued'
                          ? jobStatus.status
                          : 'queued';
                      return {
                        ...x,
                        isFailed: false,
                        errorMessage: null,
                        jobStatus: nextStatus,
                        scheduledAt: jobStatus.scheduled_at,
                        sendWaitReason: jobStatus.send_wait_reason,
                        throttleBypassNextAttempt: jobStatus.throttle_bypass_next_attempt,
                      };
                    })()
                  : x
              )
            );
          }
        } catch (err) {
          console.error('Failed to check job status:', err);
        }
      }
    };

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    const intervalId = setInterval(tick, 2000);
    pollingIntervalRef.current = intervalId;
    void tick();

    return () => {
      clearInterval(intervalId);
      if (pollingIntervalRef.current === intervalId) {
        pollingIntervalRef.current = null;
      }
    };
  }, [selectedThreadId, threadsLoading, loadMessages, toast]);

  useEffect(() => {
    if (!accountId || !selectedThreadId || threadsLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const [pendingManualJobs, pendingCampaignJobs] = await Promise.all([
          getPendingInboxManualJobs(accountId),
          getPendingCampaignReplyJobs(accountId),
        ]);
        if (cancelled) return;
        const manualJobsForThread = pendingManualJobs.filter((j) => j.thread_id === selectedThreadId);
        const campaignJobsForThread = pendingCampaignJobs.filter((j) => j.thread_id === selectedThreadId);

        const threadMessages = messagesRef.current;
        const fromEmail =
          threadMessages.find((m) => m.direction === 'sent')?.from_email ??
          threadMessages.find((m) => m.direction === 'received')?.to_email ??
          '';

        const dbIds = new Set([
          ...manualJobsForThread.map((j) => j.id),
          ...campaignJobsForThread.map((j) => j.id),
        ]);
        setPendingReplies((prev) => {
          const fromDb = [
            ...manualJobsForThread.map((j) => jobToPendingReply(j, fromEmail)),
            ...campaignJobsForThread.map((j) =>
              jobToPendingCampaignReply(j, fromEmail, mailboxSignatureRaw)
            ),
          ];
          const optimistic = prev.filter(
            (p) => p.threadId === selectedThreadId && !dbIds.has(p.jobId)
          );
          const combined = [...fromDb, ...optimistic];
          combined.sort(
            (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
          );
          return combined;
        });
      } catch (err) {
        console.error('Failed to restore pending reply:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, mailboxSignatureRaw, selectedThreadId, threadsLoading]);

  useEffect(() => {
    if (!selectedThreadId) return;
    const fromEmail =
      messages.find((m) => m.direction === 'sent')?.from_email ??
      messages.find((m) => m.direction === 'received')?.to_email ??
      '';
    if (!fromEmail) return;
    setPendingReplies((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.threadId !== selectedThreadId || p.fromEmail) return p;
        changed = true;
        return { ...p, fromEmail };
      });
      return changed ? next : prev;
    });
  }, [messages, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || threadsLoading) {
      setAutoReplyPipelineState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const state = await getThreadAutoReplyPipelineState(selectedThreadId);
        if (!cancelled) {
          setAutoReplyPipelineState(state);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch auto-reply pipeline state:', err);
          setAutoReplyPipelineState(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedThread?.category, selectedThreadId, threadsLoading, pendingReplies.length]);

  const finishOpenReplyComposer = useCallback(
    (message: EmailMessage) => {
      if (!selectedThread) return;
      const lastReceived = [...messages].reverse().find((m) => m.direction === 'received');
      const { toEmail, toName } = resolveReplyComposerTarget({
        message: {
          direction: message.direction,
          from_email: message.from_email,
          from_name: message.from_name ?? null,
        },
        lastReceived: lastReceived
          ? {
              from_email: lastReceived.from_email,
              from_name: lastReceived.from_name ?? null,
            }
          : null,
        currentLeadEmail: currentLeadEmail ?? null,
        currentLeadName: currentLeadName ?? null,
      });
      setInReplyToMessageId(message.id);
      setReplyToEmail(toEmail);
      setReplyToName(toName);
      setReplySubject(
        buildReplyDefaultSubject({
          parentMessageSubject: message.subject ?? null,
          threadSubject: selectedThread.subject ?? null,
        }),
      );

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
      setIncludeSignature(true);
      setReplyEditorMode('richText');
      setReplyHtmlDraft('');
      setReplyRichInitialContent('<p></p>');
      setComposerMode('reply');
    },
    [selectedThread, messages, currentLeadEmail, currentLeadName]
  );

  const openReplyComposer = useCallback(
    (message: EmailMessage) => {
      const hasPendingCampaignReply = pendingReplies.some(
        (p) => p.threadId === selectedThreadId && p.kind === 'campaign_priority'
      );
      if (autoReplyPipelineState || hasPendingCampaignReply) {
        const stateLabel =
          autoReplyPipelineState?.label ??
          'An automated campaign reply is scheduled to send automatically.';
        setReplyDuplicateConfirm({
          title: 'Reply anyway?',
          message: `${stateLabel} Replying now may send a duplicate message.`,
          onConfirm: () => {
            setReplyDuplicateConfirm(null);
            finishOpenReplyComposer(message);
          },
        });
        return;
      }
      finishOpenReplyComposer(message);
    },
    [
      autoReplyPipelineState,
      finishOpenReplyComposer,
      pendingReplies,
      selectedThreadId,
    ]
  );

  const openForwardComposer = useCallback(
    (_message: EmailMessage, options?: ForwardComposerPrefill) => {
      if (!selectedThread) return;
      const fwdSubject = buildForwardDefaultSubject({
        parentMessageSubject: _message.subject ?? null,
        threadSubject: selectedThread.subject ?? null,
      });
      setForwardedMessageId(_message.id);
      setForwardToEmail(options?.toEmail?.trim().toLowerCase() ?? '');
      setForwardCc('');
      setForwardSubject(fwdSubject);
      setIncludeSignature(true);
      setForwardQuoteHtml(buildForwardedConversationHtml(messages, _message, fwdSubject));
      setForwardEditorMode('richText');
      setForwardHtmlDraft('');
      setForwardRichInitialContent('<p></p>');
      setComposerMode('forward');
    },
    [selectedThread, messages]
  );

  const switchComposerToHtml = useCallback((mode: 'reply' | 'forward') => {
    const applySeededHtml = (html: string | null | undefined) => {
      const seeded = seedHtmlModeFromRichText(html ?? '<p></p>');
      if (mode === 'reply') {
        setReplyHtmlDraft(seeded);
        setReplyEditorMode('html');
        return;
      }
      setForwardHtmlDraft(seeded);
      setForwardEditorMode('html');
    };

    const editorBodyHtml = composerEditorRef.current?.getHTML?.();
    if (editorBodyHtml instanceof Promise) {
      void editorBodyHtml.then((html) => {
        applySeededHtml(html);
      });
      return;
    }

    applySeededHtml(editorBodyHtml);
  }, []);

  const confirmSwitchComposerToRich = useCallback(() => {
    if (switchToRichConfirmMode === 'reply') {
      setReplyRichInitialContent(convertHtmlToRichTextSeed(replyHtmlDraft));
      setReplyEditorMode('richText');
    } else if (switchToRichConfirmMode === 'forward') {
      setForwardRichInitialContent(convertHtmlToRichTextSeed(forwardHtmlDraft));
      setForwardEditorMode('richText');
    }
    setSwitchToRichConfirmMode(null);
  }, [forwardHtmlDraft, replyHtmlDraft, switchToRichConfirmMode]);

  const retryFailedReply = useCallback(
    async (jobId: string) => {
      if (!accountId || !selectedThreadId || !selectedThread) return;
      const pendingReply = pendingReplies.find(
        (p) => p.jobId === jobId && p.isFailed && p.kind === 'reply'
      );
      if (!pendingReply?.inReplyToMessageId) return;
      setSendingReply(true);
      try {
        const replyAttachments = pendingReply.attachments?.length
          ? pendingReply.attachments.map(({ filename, contentType, size, storagePath }) => ({
              filename,
              contentType,
              size,
              storagePath,
            }))
          : undefined;
        const newJobId = await createReplyJob({
          accountId,
          threadId: selectedThreadId,
          inReplyToMessageId: pendingReply.inReplyToMessageId,
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
        setPendingReplies((prev) =>
          prev.map((p) =>
            p.jobId === jobId
              ? {
                  ...p,
                  jobId: newJobId,
                  isFailed: false,
                  errorMessage: null,
                  jobStatus: 'queued',
                  scheduledAt: null,
                  sendWaitReason: null,
                  throttleBypassNextAttempt: false,
                  isSendingImmediately: false,
                  fromEmail,
                  receivedAt,
                }
              : p
          )
        );
        loadMessages(selectedThreadId, { force: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to retry reply');
      } finally {
        setSendingReply(false);
      }
    },
    [accountId, selectedThreadId, selectedThread, pendingReplies, messages, loadMessages, toast]
  );

  const sendReply = useCallback(
    async (skipBlockCheck?: boolean) => {
      if (!accountId || !selectedThreadId || !selectedThread || !inReplyToMessageId) return;
      if (composerAttachmentsLoading) {
        toast.error('Wait for attachments to finish uploading.');
        return;
      }
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
        const interactionMetadata = parseSmartHandlingMetadata(
          (interactionSession.getInteractionSnapshot()?.context.thread.handling_metadata ?? null) as any
        );
        let finalBodyHtml = '';
        let finalBodyText = '';
        if (replyEditorMode === 'html') {
          const canonicalDraft = canonicalizeEmailContentForSave({
            editorMode: 'html',
            bodyHtml: replyHtmlDraft,
          });
          const canonicalFinal = canonicalizeEmailContentForSave({
            editorMode: 'html',
            bodyHtml: mergeHtmlEmailWithSignature(
              canonicalDraft.bodyHtml,
              mailboxSignatureRaw,
              includeSignature
            ),
          });
          finalBodyHtml = canonicalFinal.bodyHtml;
          finalBodyText = canonicalFinal.bodyText;
        } else {
          const editorBodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
          const editorBodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? editorBodyText;
          const { bodyHtmlMerged } = mergeInboxComposeHtml(
            editorBodyHtml,
            mailboxSignatureRaw,
            includeSignature
          );
          const canonicalFinal = canonicalizeEmailContentForSave({
            editorMode: 'richText',
            bodyHtml: bodyHtmlMerged || editorBodyText,
            bodyText: stripHtml(bodyHtmlMerged || editorBodyText),
            template: editorBodyText,
          });
          finalBodyHtml = canonicalFinal.bodyHtml || editorBodyText;
          finalBodyText = canonicalFinal.bodyText || editorBodyText;
        }
        const replyAttachments =
          composerAttachments.length > 0
            ? composerAttachments.map(({ filename, contentType, size, storagePath }) => ({
                filename,
                contentType,
                size,
                storagePath,
              }))
            : undefined;
        const jobId = await createReplyJob({
          accountId,
          threadId: selectedThreadId,
          inReplyToMessageId,
          subject: replySubject.trim(),
          bodyText: finalBodyText || '',
          bodyHtml: finalBodyHtml || '',
          toEmail: replyToEmail.trim(),
          toName: replyToName.trim() || null,
          cc: ccArray.length > 0 ? ccArray : undefined,
          attachments: replyAttachments,
        });
        const composerIntent = interactionSession.consumeComposerIntent();
        await interactionSession.recordInteraction({
          action: 'thread.reply_sent',
          source: 'composer',
          intent: buildInteractionIntent({
            metadata: interactionMetadata,
            actionId: composerIntent?.actionId ?? null,
            composedBody: finalBodyText || '',
            usedSuggestedReply: detectSuggestedReplyUsage(
              composerIntent?.suggestedReply ?? interactionMetadata?.suggested_reply ?? null,
              finalBodyText || '',
            ),
          }),
          changes: [{ field: 'reply_job_created', to: jobId }],
        });
        const fromEmail = messages.find((m) => m.direction === 'sent')?.from_email ?? '';
        const receivedAt = new Date().toISOString();
        const newPending: PendingReply = {
          kind: 'reply',
          threadId: selectedThreadId,
          jobId,
          subject: replySubject.trim(),
          bodyText: finalBodyText || '',
          bodyHtml: finalBodyHtml || '',
          toEmail: replyToEmail.trim(),
          toName: replyToName.trim() || null,
          cc: ccArray,
          fromEmail,
          receivedAt,
          jobStatus: 'queued',
          scheduledAt: null,
          sendWaitReason: null,
          throttleBypassNextAttempt: false,
          inReplyToMessageId,
          attachments: replyAttachments,
        };
        setPendingReplies((prev) => [...prev, newPending]);
        closeComposerPanel();
        loadMessages(selectedThreadId, { force: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send reply');
      } finally {
        setSendingReply(false);
      }
    },
    [
      accountId,
      interactionSession,
      selectedThreadId,
      selectedThread,
      inReplyToMessageId,
      replyToEmail,
      replyToName,
      replySubject,
      replyCc,
      mailboxSignatureRaw,
      includeSignature,
      composerAttachments,
      messages,
      blockList,
      loadMessages,
      closeComposerPanel,
      toast,
      setBlockedRecipientConfirm,
      replyEditorMode,
      replyHtmlDraft,
    ]
  );

  const sendForward = useCallback(
    async (skipBlockCheck?: boolean) => {
      if (!accountId || !selectedThreadId || !selectedThread || !forwardedMessageId) return;
      if (composerAttachmentsLoading) {
        toast.error('Wait for attachments to finish uploading.');
        return;
      }
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
        const interactionMetadata = parseSmartHandlingMetadata(
          (interactionSession.getInteractionSnapshot()?.context.thread.handling_metadata ?? null) as any
        );
        let finalBodyHtml = '';
        let finalBodyText = '';
        if (forwardEditorMode === 'html') {
          const canonicalDraft = canonicalizeEmailContentForSave({
            editorMode: 'html',
            bodyHtml: forwardHtmlDraft,
          });
          const authoredHtml = mergeHtmlEmailWithSignature(
            canonicalDraft.bodyHtml,
            mailboxSignatureRaw,
            includeSignature
          );
          const canonicalFinal = canonicalizeEmailContentForSave({
            editorMode: 'html',
            bodyHtml: buildForwardComposerHtml(authoredHtml, forwardQuoteHtml),
          });
          finalBodyHtml = canonicalFinal.bodyHtml;
          finalBodyText = canonicalFinal.bodyText;
        } else {
          const editorBodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
          const editorBodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? editorBodyText;
          const { bodyHtmlMerged } = mergeInboxComposeHtml(
            editorBodyHtml,
            mailboxSignatureRaw,
            includeSignature
          );
          const canonicalFinal = canonicalizeEmailContentForSave({
            editorMode: 'html',
            bodyHtml: buildForwardComposerHtml(bodyHtmlMerged || editorBodyText, forwardQuoteHtml),
          });
          finalBodyHtml = canonicalFinal.bodyHtml || editorBodyText;
          finalBodyText = canonicalFinal.bodyText || editorBodyText;
        }
        const forwardAttachments =
          composerAttachments.length > 0
            ? composerAttachments.map(({ filename, contentType, size, storagePath }) => ({
                filename,
                contentType,
                size,
                storagePath,
              }))
            : undefined;
        const jobId = await createForwardJob({
          accountId,
          threadId: selectedThreadId,
          forwardedMessageId,
          subject: forwardSubject.trim(),
          bodyText: finalBodyText || '',
          bodyHtml: finalBodyHtml || finalBodyText,
          toEmail: forwardToEmail.trim(),
          toName: null,
          cc: ccArray.length > 0 ? ccArray : undefined,
          attachments: forwardAttachments,
        });
        const composerIntent = interactionSession.consumeComposerIntent();
        await interactionSession.recordInteraction({
          action: 'thread.forward_sent',
          source: 'composer',
          intent: buildInteractionIntent({
            metadata: interactionMetadata,
            actionId: composerIntent?.actionId ?? null,
            composedBody: finalBodyText || '',
            usedSuggestedReply: detectSuggestedReplyUsage(
              composerIntent?.suggestedReply ?? interactionMetadata?.suggested_reply ?? null,
              finalBodyText || '',
            ),
          }),
          changes: [{ field: 'forward_job_created', to: jobId }],
        });
        const fromEmail = messages.find((m) => m.direction === 'sent')?.from_email ?? '';
        const receivedAt = new Date().toISOString();
        const newPending: PendingReply = {
          kind: 'forward',
          threadId: selectedThreadId,
          jobId,
          subject: forwardSubject.trim(),
          bodyText: finalBodyText || '',
          bodyHtml: finalBodyHtml || finalBodyText,
          toEmail: forwardToEmail.trim(),
          toName: null,
          cc: ccArray,
          fromEmail,
          receivedAt,
          jobStatus: 'queued',
          scheduledAt: null,
          sendWaitReason: null,
          throttleBypassNextAttempt: false,
          forwardedMessageId,
          attachments: forwardAttachments,
        };
        setPendingReplies((prev) => [...prev, newPending]);
        closeComposerPanel();
        loadMessages(selectedThreadId, { force: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send forward');
      } finally {
        setSendingForward(false);
      }
    },
    [
      accountId,
      interactionSession,
      selectedThreadId,
      selectedThread,
      forwardedMessageId,
      forwardToEmail,
      forwardSubject,
      forwardCc,
      mailboxSignatureRaw,
      includeSignature,
      forwardQuoteHtml,
      composerAttachments,
      blockList,
      closeComposerPanel,
      messages,
      loadMessages,
      toast,
      setBlockedRecipientConfirm,
      forwardEditorMode,
      forwardHtmlDraft,
    ]
  );

  const sendPendingImmediately = useCallback(
    async (jobId: string) => {
      if (!accountId || !selectedThreadId) return;
      setSendImmediatelyJobId(jobId);
      setPendingReplies((prev) =>
        prev.map((p) =>
          p.jobId === jobId
            ? { ...p, isSendingImmediately: true }
            : p
        )
      );
      try {
        await requestImmediateManualSend(jobId);
        const scheduledAt = new Date().toISOString();
        setPendingReplies((prev) =>
          prev.map((p) =>
            p.jobId === jobId
              ? {
                  ...p,
                  jobStatus: 'queued',
                  scheduledAt,
                  sendWaitReason: null,
                  throttleBypassNextAttempt: true,
                  isSendingImmediately: false,
                }
              : p
          )
        );
        loadMessages(selectedThreadId, { silent: true });
      } catch (err) {
        setPendingReplies((prev) =>
          prev.map((p) =>
            p.jobId === jobId
              ? { ...p, isSendingImmediately: false }
              : p
          )
        );
        toast.error(err instanceof Error ? err.message : 'Failed to send immediately');
      } finally {
        setSendImmediatelyJobId((current) => (current === jobId ? null : current));
      }
    },
    [accountId, selectedThreadId, loadMessages, toast]
  );

  const cancelPendingOutbound = useCallback(
    async (jobId: string) => {
      if (!selectedThreadId) return;
      try {
        await cancelPendingOutboundJob(jobId);
        setPendingReplies((prev) => prev.filter((p) => p.jobId !== jobId));
        loadMessages(selectedThreadId, { silent: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to cancel pending outbound');
      }
    },
    [loadMessages, selectedThreadId, toast]
  );

  const handleComposerFilesSelected = useCallback(
    async (files: FileList) => {
      if (!files?.length) return;
      if (!accountId || !selectedThreadId) {
        toast.error('Select a thread before attaching files.');
        return;
      }
      if (!FETCH_ATTACHMENT_URL) {
        toast.error('Attachment upload is not configured.');
        return;
      }
      setComposerAttachmentsLoading(true);
      setComposerAttachmentsSkipMessage(null);
      const toAdd: ComposerAttachmentItem[] = [];
      let skippedTooBig = 0;
      let skippedTotal = 0;
      let skippedCount = 0;
      let skippedOther = 0;
      const currentTotal = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
      try {
        const token = await getAccessToken();
        if (!token) {
          toast.error('Not authenticated');
          return;
        }
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
            const prepared = await prepareAttachmentUpload(FETCH_ATTACHMENT_URL, token, {
              accountId,
              threadId: selectedThreadId,
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
            });
            await uploadToSignedUrl(prepared.uploadUrl, file, file.type || 'application/octet-stream', prepared.token);
            toAdd.push({
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
              storagePath: prepared.storagePath,
            });
          } catch (err) {
            console.error('Attachment upload failed:', err);
            skippedOther += 1;
          }
        }
      } finally {
        setComposerAttachmentsLoading(false);
      }
      if (toAdd.length > 0) {
        setComposerAttachments((prev) => [...prev, ...toAdd]);
      }
      const skippedTotalCount = skippedTooBig + skippedTotal + skippedCount + skippedOther;
      if (skippedTotalCount > 0) {
        const parts: string[] = [];
        if (skippedTooBig > 0) parts.push(`${skippedTooBig} over 2 MB`);
        if (skippedTotal > 0) parts.push(`${skippedTotal} would exceed 5 MB total`);
        if (skippedCount > 0) parts.push(`${skippedCount} over 10 file limit`);
        if (skippedOther > 0) parts.push(`${skippedOther} could not be uploaded`);
        setComposerAttachmentsSkipMessage(
          toAdd.length > 0
            ? `${skippedTotalCount} file${skippedTotalCount !== 1 ? 's' : ''} skipped (${parts.join(', ')})`
            : `No files added. ${skippedTotalCount} file${skippedTotalCount !== 1 ? 's' : ''} skipped (${parts.join(', ')})`
        );
      }
    },
    [accountId, selectedThreadId, composerAttachments, toast]
  );

  const handleRemoveComposerAttachment = useCallback(
    async (attachment: ComposerAttachmentItem) => {
      if (!FETCH_ATTACHMENT_URL || !attachment.storagePath) return;
      try {
        const token = await getAccessToken();
        if (!token) return;
        await deleteAttachmentUpload(FETCH_ATTACHMENT_URL, token, attachment.storagePath);
      } catch (err) {
        console.error('Failed to delete pending attachment:', err);
      }
    },
    []
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
    pendingReplies,
    autoReplyPipelineState,
    replyDuplicateConfirm,
    setReplyDuplicateConfirm,
    includeSignature,
    setIncludeSignature,
    forwardQuoteHtml,
    replyEditorMode,
    setReplyEditorMode,
    forwardEditorMode,
    setForwardEditorMode,
    replyHtmlDraft,
    setReplyHtmlDraft,
    forwardHtmlDraft,
    setForwardHtmlDraft,
    replyRichInitialContent,
    setReplyRichInitialContent,
    forwardRichInitialContent,
    setForwardRichInitialContent,
    switchToRichConfirmMode,
    setSwitchToRichConfirmMode,
    composerEditorRef,
    slideAnim,
    closeComposerPanel,
    openReplyComposer,
    openForwardComposer,
    switchComposerToHtml,
    confirmSwitchComposerToRich,
    sendReply,
    sendForward,
    sendPendingImmediately,
    cancelPendingOutbound,
    retryFailedReply,
    handleComposerFilesSelected,
    handleRemoveComposerAttachment,
  };
}
