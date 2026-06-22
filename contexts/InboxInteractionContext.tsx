import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { InboxInteractionAction, InboxInteractionChange, InboxInteractionContext as InboxInteractionSnapshot, InboxInteractionIntent, InboxInteractionSource } from '@/lib/inbox/inboxInteractions';
import { recordInboxInteraction } from '@/lib/inbox/inboxInteractions';

export interface CurrentInboxInteractionSnapshot {
  account_id: string;
  thread_id: string;
  lead_id: string | null;
  trigger_message_id: string | null;
  classification_completed_at: string | null;
  suggestion_mode: 'manual' | 'ai' | null;
  suggestion_version: string | null;
  context: InboxInteractionSnapshot;
}

export interface ComposerInteractionIntent {
  actionId?: string | null;
  suggestedReply?: string | null;
}

interface RecordInteractionInput {
  action: InboxInteractionAction;
  source: InboxInteractionSource;
  intent?: InboxInteractionIntent | null;
  changes?: InboxInteractionChange[] | null;
}

interface InboxInteractionContextValue {
  getInteractionSnapshot: () => CurrentInboxInteractionSnapshot | null;
  setInteractionSnapshot: (snapshot: CurrentInboxInteractionSnapshot | null) => void;
  recordInteraction: (input: RecordInteractionInput) => Promise<void>;
  setComposerIntent: (intent: ComposerInteractionIntent | null) => void;
  consumeComposerIntent: () => ComposerInteractionIntent | null;
}

const InboxInteractionContext = createContext<InboxInteractionContextValue | null>(null);

export function InboxInteractionProvider({ children }: { children: ReactNode }) {
  const snapshotRef = useRef<CurrentInboxInteractionSnapshot | null>(null);
  const composerIntentRef = useRef<ComposerInteractionIntent | null>(null);
  const [, setComposerIntentState] = useState<ComposerInteractionIntent | null>(null);

  const setInteractionSnapshot = useCallback((snapshot: CurrentInboxInteractionSnapshot | null) => {
    snapshotRef.current = snapshot;
  }, []);

  const getInteractionSnapshot = useCallback(() => snapshotRef.current, []);

  const setComposerIntent = useCallback((intent: ComposerInteractionIntent | null) => {
    composerIntentRef.current = intent;
    setComposerIntentState(intent);
  }, []);

  const consumeComposerIntent = useCallback(() => {
    const current = composerIntentRef.current;
    composerIntentRef.current = null;
    setComposerIntentState(null);
    return current;
  }, []);

  const recordInteraction = useCallback(async (input: RecordInteractionInput) => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return;

    await recordInboxInteraction({
      account_id: snapshot.account_id,
      thread_id: snapshot.thread_id,
      lead_id: snapshot.lead_id,
      trigger_message_id: snapshot.trigger_message_id,
      classification_completed_at: snapshot.classification_completed_at,
      suggestion_mode: snapshot.suggestion_mode,
      suggestion_version: snapshot.suggestion_version,
      action: input.action,
      source: input.source,
      intent: input.intent ?? null,
      context: snapshot.context,
      changes: input.changes ?? null,
    });
  }, []);

  const value = useMemo<InboxInteractionContextValue>(
    () => ({
      getInteractionSnapshot,
      setInteractionSnapshot,
      recordInteraction,
      setComposerIntent,
      consumeComposerIntent,
    }),
    [consumeComposerIntent, getInteractionSnapshot, recordInteraction, setComposerIntent, setInteractionSnapshot],
  );

  return <InboxInteractionContext.Provider value={value}>{children}</InboxInteractionContext.Provider>;
}

export function useInboxInteractionSession() {
  const context = useContext(InboxInteractionContext);
  if (!context) {
    throw new Error('useInboxInteractionSession must be used within InboxInteractionProvider');
  }
  return context;
}
