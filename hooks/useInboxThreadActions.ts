import { useCallback, useEffect, useRef, useState } from 'react';
import type { Router } from 'expo-router';
import { addBlockEntry, closeConversation, saveEmailThreadOutOfOffice } from '@/lib/supabase/services';
import type { EmailMessage, EmailThread } from '@/lib/supabase/types';
import { finalizeThreadActionOnServer } from '@/lib/inbox/finalizeThreadAction';
import {
  buildReplaceLeadFollowUpAction,
  resolveReplaceLeadForwardMessage,
  type ReplaceLeadCompletionPayload,
  type ReplaceLeadFollowUpAction,
} from '@/lib/inbox/replaceLeadCompletion';
import { applyImmediateEffects } from '@/lib/inbox/runThreadActionEffects';
import {
  getThreadActionDefinition,
  isDeferredThreadAction,
  resolveFinalizeSteps,
  shouldAutoCloseConversationForAction,
  type ThreadActionId,
  type ThreadActionSource,
} from '@/lib/inbox/threadActionDefinitions';
import { getSmartHandlingReplySeed, type SmartHandlingActionOption, type SmartHandlingMetadata } from '@/lib/inbox/smartHandling';
import { useInboxThreadActionSession } from '@/contexts/InboxThreadActionContext';

export interface UseInboxThreadActionsParams {
  accountId: string | null;
  selectedThreadId: string | null;
  selectedThread: EmailThread | null;
  isMobile: boolean;
  router: Router;
  smartHandlingMetadata: SmartHandlingMetadata | null;
  selectedThreadProspectEmails: string[];
  latestReceivedInbound: EmailMessage | null;
  messages: EmailMessage[];
  setThreads: React.Dispatch<React.SetStateAction<EmailThread[]>>;
  loadThreads: () => Promise<void>;
  loadMessages: (threadId: string, options?: { silent?: boolean }) => Promise<void>;
  loadBlockList: () => Promise<void>;
  setCategory: (category: string | null) => Promise<void>;
  openReplyComposer: (message: EmailMessage) => void;
  openForwardComposer: (
    message: EmailMessage,
    options?: { toEmail?: string | null; toName?: string | null }
  ) => void;
  setReplyHtmlDraft: (html: string) => void;
  setReplyRichInitialContent: (html: string) => void;
  buildSuggestedReplyHtml: (value: string) => string;
  dismissSmartHandling: () => void;
  toast: {
    error: (message: string) => void;
  };
}

export function useInboxThreadActions({
  accountId,
  selectedThreadId,
  selectedThread,
  isMobile,
  router,
  smartHandlingMetadata,
  selectedThreadProspectEmails,
  latestReceivedInbound,
  messages,
  setThreads,
  loadThreads,
  loadMessages,
  loadBlockList,
  setCategory,
  openReplyComposer,
  openForwardComposer,
  setReplyHtmlDraft,
  setReplyRichInitialContent,
  buildSuggestedReplyHtml,
  dismissSmartHandling,
  toast,
}: UseInboxThreadActionsParams) {
  const session = useInboxThreadActionSession();
  const [oooModalVisible, setOooModalVisible] = useState(false);
  const [oooModalPrefillOverride, setOooModalPrefillOverride] = useState<string | null | undefined>(undefined);
  const [replaceLeadModalVisible, setReplaceLeadModalVisible] = useState(false);
  const [pendingClientFollowUp, setPendingClientFollowUp] = useState<{
    threadId: string;
    action: ReplaceLeadFollowUpAction;
  } | null>(null);
  const queuedDeferredActionRef = useRef<ThreadActionId | null>(null);

  const pendingDeferredAction = session.pendingDeferredAction;
  const pendingOooActionId: ThreadActionId | null =
    pendingDeferredAction?.actionId === 'mark_ooo_custom' ||
    pendingDeferredAction?.actionId === 'mark_out_of_office'
      ? pendingDeferredAction.actionId
      : null;

  const closeConversationOptimistic = useCallback(
    async (threadId: string, source: 'user' | 'system' = 'system') => {
      await closeConversation(threadId, source);
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                conversation_status: 'closed',
                conversation_status_source: source,
              }
            : thread,
        ),
      );
    },
    [setThreads],
  );

  const refreshThreadData = useCallback(
    async (threadId: string) => {
      await loadThreads();
      await loadMessages(threadId, { silent: true });
    },
    [loadMessages, loadThreads],
  );

  useEffect(() => {
    return session.registerRefreshHandler(async (threadId) => {
      await refreshThreadData(threadId);
    });
  }, [refreshThreadData, session]);

  useEffect(() => {
    const hint = session.clientFinalizeHint;
    if (!hint || hint.threadId !== selectedThreadId) return;

    const consumedHint = session.consumeClientFinalizeHint();
    if (!consumedHint) return;

    if (consumedHint.dismissSmartHandling) {
      dismissSmartHandling();
    }
    if (consumedHint.refresh) {
      void refreshThreadData(consumedHint.threadId);
    }
    if (consumedHint.followUpAction) {
      setPendingClientFollowUp({
        threadId: consumedHint.threadId,
        action: consumedHint.followUpAction,
      });
    }
  }, [
    dismissSmartHandling,
    refreshThreadData,
    selectedThreadId,
    session,
    session.clientFinalizeHint,
  ]);

  useEffect(() => {
    if (!pendingClientFollowUp || pendingClientFollowUp.threadId !== selectedThreadId) return;

    const sourceMessage = resolveReplaceLeadForwardMessage(
      messages,
      pendingClientFollowUp.action.preferredForwardMessageId,
    );
    if (!sourceMessage) {
      if (messages.length === 0) return;
      toast.error('Lead replaced, but there was no message available to forward.');
      setPendingClientFollowUp(null);
      return;
    }

    openForwardComposer(sourceMessage, pendingClientFollowUp.action.target);
    setPendingClientFollowUp(null);
  }, [messages, openForwardComposer, pendingClientFollowUp, selectedThreadId, toast]);

  const finalizeThreadActionOutcome = useCallback(
    async (
      actionId: ThreadActionId,
      source: ThreadActionSource,
      phase: 'immediate' | 'complete',
      options?: { conversationCloseSource?: 'user' | 'system' },
    ) => {
      if (!selectedThreadId) return;

      const steps = resolveFinalizeSteps(actionId, source, phase);

      if (phase === 'complete' && steps.setCategoryOnComplete) {
        await setCategory(steps.setCategoryOnComplete);
      }

      if (steps.closeConversation) {
        await closeConversationOptimistic(
          selectedThreadId,
          options?.conversationCloseSource ?? 'system',
        );
      }

      if (steps.dismissSmartHandling) {
        dismissSmartHandling();
      }

      if (steps.refresh) {
        await refreshThreadData(selectedThreadId);
      }
    },
    [
      dismissSmartHandling,
      refreshThreadData,
      selectedThreadId,
      setCategory,
    ],
  );

  const openDeferredPresentation = useCallback(
    (actionId: ThreadActionId, source: ThreadActionSource) => {
      if (!selectedThreadId) return;

      session.setPendingDeferredAction({
        actionId,
        source,
        threadId: selectedThreadId,
      });

      const presentation = getThreadActionDefinition(actionId).presentation;
      if (!presentation) return;

      if (actionId === 'mark_ooo_custom') {
        setOooModalPrefillOverride(null);
        setOooModalVisible(true);
        return;
      }

      if (actionId === 'mark_out_of_office') {
        setOooModalPrefillOverride(undefined);
        setOooModalVisible(true);
        return;
      }

      if (actionId === 'replace_lead') {
        if (isMobile && presentation.mobile === 'page' && presentation.mobileRoute) {
          router.push({ pathname: presentation.mobileRoute, params: { thread: selectedThreadId } });
          return;
        }
        setReplaceLeadModalVisible(true);
      }
    },
    [isMobile, router, selectedThreadId, session],
  );

  const applyOooOptimisticState = useCallback(
    (
      threadId: string,
      result: 'scheduled_stopped' | 'resumed_stopped' | 'resumed_held' | 'marked_only' | 'no_resumable_execution_state',
      options?: { markAutoReply?: boolean; resumeAt?: string | null },
    ) => {
      const nowIso = new Date().toISOString();
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                out_of_office: true,
                category: options?.markAutoReply ? 'Auto Reply' : thread.category,
                category_source: options?.markAutoReply
                  ? thread.category === 'Auto Reply' && thread.category_source
                    ? thread.category_source
                    : 'user'
                  : thread.category_source,
                handling_metadata:
                  options?.markAutoReply && thread.handling_metadata && typeof thread.handling_metadata === 'object'
                    ? {
                        ...thread.handling_metadata,
                        category: 'Auto Reply',
                      }
                    : thread.handling_metadata,
                ooo_resume_at:
                  result === 'marked_only' || result === 'no_resumable_execution_state'
                    ? null
                    : options?.resumeAt ?? thread.ooo_resume_at,
                ooo_resume_requested: result === 'scheduled_stopped',
                ooo_resume_processed_at:
                  result === 'scheduled_stopped'
                    ? null
                    : result === 'marked_only' || result === 'no_resumable_execution_state'
                      ? null
                      : nowIso,
              }
            : thread,
        ),
      );
    },
    [setThreads],
  );

  const runThreadAction = useCallback(
    async (actionId: ThreadActionId, source: ThreadActionSource) => {
      if (!selectedThreadId || !selectedThread) return;

      try {
        if (actionId === 'close_conversation') {
          await closeConversationOptimistic(selectedThreadId, 'user');
          return;
        }

        if (isDeferredThreadAction(actionId)) {
          openDeferredPresentation(actionId, source);
          return;
        }

        const maybeSuggestedReply =
          source === 'smart_handling'
            ? getSmartHandlingReplySeed(smartHandlingMetadata, actionId as SmartHandlingActionOption['action'])
            : '';

        await applyImmediateEffects(actionId, {
          threadId: selectedThreadId,
          accountId,
          metadata: smartHandlingMetadata,
          prospectEmails: selectedThreadProspectEmails,
          latestReceivedInbound,
          setCategory,
          markOoo: async ({ resumeAt, returnDateYmd }) => {
            const result = await saveEmailThreadOutOfOffice({
              threadId: selectedThreadId,
              outOfOffice: true,
              resumeRequested: true,
              resumeAt,
              returnDateYmd,
              markAutoReply: true,
            });
            applyOooOptimisticState(selectedThreadId, result, {
              markAutoReply: true,
              resumeAt,
            });
          },
          blockSender: async () => {
            if (!accountId) return;
            await Promise.allSettled(
              selectedThreadProspectEmails.map((email) =>
                addBlockEntry(accountId, { value: email, type: 'email' }),
              ),
            );
            await loadBlockList();
          },
          openComposer: (message, suggestedReplyHtml) => {
            openReplyComposer(message);
            if (suggestedReplyHtml) {
              setReplyHtmlDraft(suggestedReplyHtml);
              setReplyRichInitialContent(suggestedReplyHtml);
            } else if (maybeSuggestedReply) {
              const seededHtml = buildSuggestedReplyHtml(maybeSuggestedReply);
              setReplyHtmlDraft(seededHtml);
              setReplyRichInitialContent(seededHtml);
            }
          },
        });

        if (shouldAutoCloseConversationForAction(actionId)) {
          await finalizeThreadActionOutcome(actionId, source, 'immediate');
        } else {
          const steps = resolveFinalizeSteps(actionId, source, 'immediate');
          if (steps.dismissSmartHandling) {
            dismissSmartHandling();
          }
        }
      } catch (error) {
        console.error('Thread action failed:', error);
        toast.error('Failed to apply smart handling action.');
      }
    },
    [
      accountId,
      buildSuggestedReplyHtml,
      closeConversationOptimistic,
      dismissSmartHandling,
      finalizeThreadActionOutcome,
      latestReceivedInbound,
      loadBlockList,
      openDeferredPresentation,
      openReplyComposer,
      selectedThread,
      selectedThreadId,
      selectedThreadProspectEmails,
      setCategory,
      applyOooOptimisticState,
      setReplyHtmlDraft,
      setReplyRichInitialContent,
      smartHandlingMetadata,
      toast,
    ],
  );

  const runFromSmartHandling = useCallback(
    async (option: SmartHandlingActionOption) => {
      await runThreadAction(option.action, 'smart_handling');
    },
    [runThreadAction],
  );

  const runFromMessageMenu = useCallback(
    async (actionId: ThreadActionId) => {
      await runThreadAction(actionId, 'message_menu');
    },
    [runThreadAction],
  );

  const completeDeferredAction = useCallback(
    async (actionId: ThreadActionId, completion?: ReplaceLeadCompletionPayload | null) => {
      const pending = session.pendingDeferredAction;
      if (!pending || pending.actionId !== actionId) return;
      const followUpAction =
        actionId === 'replace_lead' ? buildReplaceLeadFollowUpAction(completion) : null;
      const forwardMessage =
        followUpAction != null
          ? resolveReplaceLeadForwardMessage(messages, followUpAction.preferredForwardMessageId)
          : null;

      if (actionId === 'replace_lead') {
        setReplaceLeadModalVisible(false);
      }
      if (actionId === 'mark_ooo_custom' || actionId === 'mark_out_of_office') {
        setOooModalVisible(false);
        setOooModalPrefillOverride(undefined);
      }

      const steps = await finalizeThreadActionOnServer({
        threadId: pending.threadId,
        actionId: pending.actionId,
        source: pending.source,
        phase: 'complete',
      });
      session.setPendingDeferredAction(null);

      if (steps.setCategoryOnComplete) {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === pending.threadId
              ? {
                  ...thread,
                  category: steps.setCategoryOnComplete,
                  category_source: 'user',
                }
              : thread,
          ),
        );
      }

      if (steps.closeConversation) {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === pending.threadId
              ? {
                  ...thread,
                  conversation_status: 'closed',
                  conversation_status_source: 'system',
                }
              : thread,
          ),
        );
      }

      if (steps.dismissSmartHandling) {
        dismissSmartHandling();
      }

      if (steps.refresh) {
        await refreshThreadData(pending.threadId);
      }

      if (followUpAction) {
        if (!forwardMessage) {
          toast.error('Lead replaced, but there was no message available to forward.');
        } else {
          openForwardComposer(forwardMessage, followUpAction.target);
        }
      }
    },
    [dismissSmartHandling, messages, openForwardComposer, refreshThreadData, session, setThreads, toast],
  );

  const closeOooModal = useCallback(() => {
    setOooModalVisible(false);
    setOooModalPrefillOverride(undefined);
    session.setPendingDeferredAction(null);
  }, [session]);

  const queueDeferredOpen = useCallback((actionId: ThreadActionId) => {
    queuedDeferredActionRef.current = actionId;
  }, []);

  const consumeQueuedOpen = useCallback(() => {
    const actionId = queuedDeferredActionRef.current;
    if (!actionId) return;
    queuedDeferredActionRef.current = null;
    void runFromMessageMenu(actionId);
  }, [runFromMessageMenu]);

  const clearQueuedOpen = useCallback(() => {
    queuedDeferredActionRef.current = null;
  }, []);

  return {
    oooModalVisible,
    oooModalPrefillOverride,
    replaceLeadModalVisible,
    setReplaceLeadModalVisible,
    pendingOooActionId,
    runFromSmartHandling,
    runFromMessageMenu,
    completeDeferredAction,
    closeOooModal,
    queueDeferredOpen,
    consumeQueuedOpen,
    clearQueuedOpen,
  };
}
