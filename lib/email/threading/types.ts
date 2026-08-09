/**
 * Shared vocabulary for Furnace threading decisions.
 *
 * A thread timeline is the ordered union of everything Furnace knows about one
 * conversation: outbound sends (from message_jobs) and inbound replies (from
 * email_messages). A *subject epoch* is a run of that timeline sharing one
 * client-side conversation; an outbound with an explicit subject opens a new one.
 */

export type ThreadMessageDirection = 'sent' | 'received';

/** How the outbound threading context for a send was arrived at. */
export type ThreadingDecision =
  /** First message in the conversation; no parent exists. */
  | 'root'
  /** Continues the newest subject epoch, parenting its most recent message. */
  | 'continue-epoch'
  /** Explicit subject; deliberately starts a fresh client-side conversation. */
  | 'new-epoch'
  /** Caller chose the parent (manual composer reply). */
  | 'explicit-parent';

/** A timeline entry before epoch tagging. */
export type ThreadTimelineInput = {
  /** Wire Message-ID. Entries without a usable ID are dropped. */
  wireMessageId: string | null | undefined;
  direction: ThreadMessageDirection;
  /** ISO timestamp used for ordering. */
  at: string | null | undefined;
  /** Exact subject that went on the wire. Empty string is a valid subject. */
  deliveredSubject?: string | null;
  /** Raw node/variant subject template, used only as a render fallback. */
  subjectTemplate?: string | null;
  /**
   * True when this outbound carried an explicit (non-continuing) subject and
   * therefore opened a new epoch.
   */
  startsEpoch?: boolean;
  /** Persisted epoch key, when known. Seeds the walk for partial windows. */
  conversationRootMessageId?: string | null;
  emailMessageId?: string | null;
  messageJobId?: string | null;
  /** Parsed id array or a raw References header string; both are accepted. */
  referenceMessageIds?: string | string[] | null;
};

/** A timeline entry after normalization, ordering, and epoch tagging. */
export type ThreadTimelineEntry = {
  /** Normalized (unbracketed, lowercased) wire Message-ID. */
  wireMessageId: string;
  direction: ThreadMessageDirection;
  at: string;
  deliveredSubject: string;
  subjectTemplate: string | null;
  startsEpoch: boolean;
  /** Wire Message-ID of the first message in this entry's epoch. */
  conversationRootMessageId: string;
  emailMessageId: string | null;
  messageJobId: string | null;
  referenceMessageIds: string[];
};

/** Everything a sender needs to put one outbound message on the wire. */
export type OutboundThreadingContext = {
  /** Exact subject to send. Empty string is valid and must not be replaced. */
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  referenceMessageIds: string[];
  threadTopic: string | null;
  /** Normalized parent Message-ID, for persistence and assertions. */
  parentWireMessageId: string | null;
  /** email_messages.id of the parent when the parent is a stored row. */
  parentEmailMessageId: string | null;
  /**
   * Epoch this send belongs to, or null when the send itself opens the epoch
   * (the caller stamps its own Message-ID as the root).
   */
  conversationRootMessageId: string | null;
  decision: ThreadingDecision;
};
