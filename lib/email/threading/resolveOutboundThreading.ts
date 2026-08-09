import {
  isThreadContinuingSubject,
  resolveCampaignFollowUpSubject,
} from '../followUpSubject.js';
import type { LeadLike } from '../mergeTemplate.js';
import {
  DEFAULT_REFERENCES_MAX_BYTES,
  buildReferencesFromAncestorIds,
  buildReplyThreadingHeaders,
  normalizeMessageId,
  normalizeThreadTopic,
} from '../threadHeaders.js';
import { newestEpochEntries } from './timeline.js';
import type {
  OutboundThreadingContext,
  ThreadTimelineEntry,
  ThreadingDecision,
} from './types.js';

export type ResolveOutboundThreadingInput = {
  /**
   * Raw node/variant subject template for this send, before rendering. This is
   * what decides continuation: an empty template means "stay in the thread".
   */
  subjectTemplate: string | null | undefined;
  /** Subject after spintax and merge fields are applied. */
  renderedSubject: string | null | undefined;
  /** Epoch-tagged thread timeline, oldest first. */
  timeline: ThreadTimelineEntry[];
  /** Manual composer reply: the parent the user selected. Overrides epoch logic. */
  explicitParentWireId?: string | null;
  /** Only needed to render a template when no delivered subject was recorded. */
  lead?: LeadLike | null;
  maxBytes?: number;
};

/**
 * The one place Furnace decides a message's subject and RFC ancestry.
 *
 * Every outbound path routes through here so campaign sends, priority replies,
 * and manual composer replies cannot drift apart. The rules are the threading
 * contract in docs/engineering/email-threading-test-contract.md.
 */
export function resolveOutboundThreading(
  input: ResolveOutboundThreadingInput,
): OutboundThreadingContext {
  const maxBytes = input.maxBytes ?? DEFAULT_REFERENCES_MAX_BYTES;
  const rendered = String(input.renderedSubject ?? '');

  const explicitParent = normalizeMessageId(input.explicitParentWireId);
  if (explicitParent) {
    return buildExplicitParentContext({ ...input, explicitParent, rendered, maxBytes });
  }

  // An explicit subject deliberately starts a fresh conversation, so it inherits
  // no ancestry. This send becomes the root of a new epoch.
  if (!isThreadContinuingSubject(input.subjectTemplate)) {
    return unthreaded({ subject: rendered, decision: 'new-epoch' });
  }

  if (input.timeline.length === 0) {
    // Rule 3: an empty first subject is valid. Never invent a placeholder.
    return unthreaded({ subject: isThreadContinuingSubject(rendered) ? '' : rendered, decision: 'root' });
  }

  const epoch = newestEpochEntries(input.timeline);
  const epochRoot = epoch[0]!;
  const parent = epoch[epoch.length - 1]!;

  // Rule 5: inherit the newest epoch's subject, not the campaign's oldest.
  // Rule 6: reuse the exact delivered string so spintax never re-spins.
  const subject = resolveCampaignFollowUpSubject({
    currentSubject: rendered,
    firstSentSubject: epochRoot.deliveredSubject,
    firstSubjectTemplate: epochRoot.subjectTemplate ?? '',
    lead: input.lead ?? {},
  });

  // Rule 2: the parent is the most recent message in the epoch regardless of
  // direction, which is what makes a priority reply parent the triggering inbound.
  const headers = buildReferencesFromAncestorIds(
    epoch.map((entry) => entry.wireMessageId),
    maxBytes,
  );

  return {
    subject,
    inReplyTo: headers?.inReplyTo ?? null,
    references: headers?.references ?? null,
    referenceMessageIds: headers?.referenceMessageIds ?? [],
    threadTopic: normalizeThreadTopic(subject),
    parentWireMessageId: parent.wireMessageId,
    parentEmailMessageId: parent.emailMessageId,
    conversationRootMessageId: epochRoot.conversationRootMessageId,
    decision: 'continue-epoch',
  };
}

function buildExplicitParentContext(
  params: ResolveOutboundThreadingInput & {
    explicitParent: string;
    rendered: string;
    maxBytes: number;
  },
): OutboundThreadingContext {
  const parentEntry =
    params.timeline.find((entry) => entry.wireMessageId === params.explicitParent) ?? null;

  const headers = buildReplyThreadingHeaders({
    parentMessageId: params.explicitParent,
    parentReferences: parentEntry?.referenceMessageIds ?? null,
    maxBytes: params.maxBytes,
  });

  return {
    subject: params.rendered,
    inReplyTo: headers?.inReplyTo ?? null,
    references: headers?.references ?? null,
    referenceMessageIds: headers?.referenceMessageIds ?? [],
    threadTopic: normalizeThreadTopic(params.rendered),
    parentWireMessageId: params.explicitParent,
    parentEmailMessageId: parentEntry?.emailMessageId ?? null,
    conversationRootMessageId:
      parentEntry?.conversationRootMessageId ?? params.explicitParent,
    decision: 'explicit-parent',
  };
}

function unthreaded(params: {
  subject: string;
  decision: ThreadingDecision;
}): OutboundThreadingContext {
  return {
    subject: params.subject,
    inReplyTo: null,
    references: null,
    referenceMessageIds: [],
    threadTopic: normalizeThreadTopic(params.subject),
    parentWireMessageId: null,
    parentEmailMessageId: null,
    conversationRootMessageId: null,
    decision: params.decision,
  };
}
