import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { finalizeThreadActionOnServer } from '@/lib/inbox/finalizeThreadAction';
import {
  buildReplaceLeadFollowUpAction,
  type ReplaceLeadCompletionPayload,
  type ReplaceLeadFollowUpAction,
} from '@/lib/inbox/replaceLeadCompletion';
import type { ThreadActionId, ThreadActionSource } from '@/lib/inbox/threadActionDefinitions';

export interface PendingDeferredAction {
  actionId: ThreadActionId;
  source: ThreadActionSource;
  threadId: string;
}

export interface ClientFinalizeHint {
  threadId: string;
  dismissSmartHandling: boolean;
  refresh: boolean;
  followUpAction: ReplaceLeadFollowUpAction | null;
}

interface InboxThreadActionContextValue {
  pendingDeferredAction: PendingDeferredAction | null;
  setPendingDeferredAction: (action: PendingDeferredAction | null) => void;
  clientFinalizeHint: ClientFinalizeHint | null;
  consumeClientFinalizeHint: () => ClientFinalizeHint | null;
  completeDeferredActionOnServer: (
    actionId: ThreadActionId,
    completion?: ReplaceLeadCompletionPayload | null
  ) => Promise<void>;
  registerRefreshHandler: (handler: (threadId: string) => Promise<void>) => () => void;
}

const InboxThreadActionContext = createContext<InboxThreadActionContextValue | null>(null);

export function InboxThreadActionProvider({ children }: { children: ReactNode }) {
  const [pendingDeferredAction, setPendingDeferredActionState] = useState<PendingDeferredAction | null>(null);
  const pendingDeferredActionRef = useRef<PendingDeferredAction | null>(null);
  const [clientFinalizeHint, setClientFinalizeHint] = useState<ClientFinalizeHint | null>(null);
  const refreshHandlerRef = useRef<((threadId: string) => Promise<void>) | null>(null);

  const setPendingDeferredAction = useCallback((action: PendingDeferredAction | null) => {
    pendingDeferredActionRef.current = action;
    setPendingDeferredActionState(action);
  }, []);

  const registerRefreshHandler = useCallback((handler: (threadId: string) => Promise<void>) => {
    refreshHandlerRef.current = handler;
    return () => {
      if (refreshHandlerRef.current === handler) {
        refreshHandlerRef.current = null;
      }
    };
  }, []);

  const completeDeferredActionOnServer = useCallback(async (
    actionId: ThreadActionId,
    completion?: ReplaceLeadCompletionPayload | null
  ) => {
    const pending = pendingDeferredActionRef.current;
    if (!pending || pending.actionId !== actionId) return;

    const steps = await finalizeThreadActionOnServer({
      threadId: pending.threadId,
      actionId: pending.actionId,
      source: pending.source,
      phase: 'complete',
    });

    setClientFinalizeHint({
      threadId: pending.threadId,
      dismissSmartHandling: steps.dismissSmartHandling,
      refresh: steps.refresh,
      followUpAction: actionId === 'replace_lead' ? buildReplaceLeadFollowUpAction(completion) : null,
    });
    setPendingDeferredAction(null);

    if (steps.refresh) {
      await refreshHandlerRef.current?.(pending.threadId);
    }
  }, [setPendingDeferredAction]);

  const consumeClientFinalizeHint = useCallback(() => {
    const hint = clientFinalizeHint;
    if (!hint) return null;
    setClientFinalizeHint(null);
    return hint;
  }, [clientFinalizeHint]);

  const value = useMemo(
    () => ({
      pendingDeferredAction,
      setPendingDeferredAction,
      clientFinalizeHint,
      consumeClientFinalizeHint,
      completeDeferredActionOnServer,
      registerRefreshHandler,
    }),
    [
      pendingDeferredAction,
      clientFinalizeHint,
      consumeClientFinalizeHint,
      completeDeferredActionOnServer,
      registerRefreshHandler,
    ],
  );

  return <InboxThreadActionContext.Provider value={value}>{children}</InboxThreadActionContext.Provider>;
}

export function useInboxThreadActionSession() {
  const context = useContext(InboxThreadActionContext);
  if (!context) {
    throw new Error('useInboxThreadActionSession must be used within InboxThreadActionProvider');
  }
  return context;
}
