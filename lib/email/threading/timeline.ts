import { normalizeMessageId, parseMessageIds } from '../threadHeaders.js';
import type { ThreadTimelineEntry, ThreadTimelineInput } from './types.js';

/**
 * Normalize, dedupe, order, and epoch-tag a thread timeline.
 *
 * Entries arrive from two sources that overlap: a campaign send exists as a
 * message_job immediately and gains an email_messages row once backfill runs.
 * Both describe the same wire message, so they are merged by Message-ID.
 *
 * Ordering is a stable sort on timestamp, so callers passing each source in
 * chronological order get a deterministic interleave for equal timestamps.
 */
export function buildThreadTimeline(inputs: ThreadTimelineInput[]): ThreadTimelineEntry[] {
  const merged = new Map<string, ThreadTimelineInput & { wireMessageId: string; at: string }>();

  for (const input of inputs) {
    const wireMessageId = normalizeMessageId(input.wireMessageId);
    if (!wireMessageId) continue;
    const at = String(input.at ?? '').trim();
    if (!at) continue;

    const existing = merged.get(wireMessageId);
    if (!existing) {
      merged.set(wireMessageId, { ...input, wireMessageId, at });
      continue;
    }
    merged.set(wireMessageId, mergeDuplicate(existing, { ...input, wireMessageId, at }));
  }

  const ordered = [...merged.values()].sort((a, b) => compareTimestamps(a.at, b.at));

  const entries: ThreadTimelineEntry[] = [];
  let currentRoot: string | null = null;

  for (const input of ordered) {
    const startsEpoch = input.startsEpoch === true;
    if (startsEpoch) {
      currentRoot = input.wireMessageId;
    } else if (currentRoot === null) {
      // Either the true root, or the oldest entry of a partial window whose
      // epoch began before it. A persisted key tells us which.
      currentRoot = normalizeMessageId(input.conversationRootMessageId) ?? input.wireMessageId;
    }

    entries.push({
      wireMessageId: input.wireMessageId,
      direction: input.direction,
      at: input.at,
      deliveredSubject: String(input.deliveredSubject ?? ''),
      subjectTemplate: input.subjectTemplate == null ? null : String(input.subjectTemplate),
      startsEpoch,
      conversationRootMessageId: currentRoot,
      emailMessageId: input.emailMessageId ?? null,
      messageJobId: input.messageJobId ?? null,
      referenceMessageIds: parseMessageIds(input.referenceMessageIds ?? null),
    });
  }

  return entries;
}

/**
 * Entries for the newest epoch in the timeline, oldest first.
 * Empty when the timeline is empty.
 */
export function newestEpochEntries(timeline: ThreadTimelineEntry[]): ThreadTimelineEntry[] {
  const last = timeline[timeline.length - 1];
  if (!last) return [];
  return timeline.filter(
    (entry) => entry.conversationRootMessageId === last.conversationRootMessageId,
  );
}

/**
 * Merge two views of the same wire message. The message_job view knows the node
 * template and whether it opened an epoch; the email_messages view knows the row
 * id. Prefer whichever side actually carries each fact.
 */
function mergeDuplicate<T extends ThreadTimelineInput & { wireMessageId: string; at: string }>(
  a: T,
  b: T,
): T {
  const deliveredSubject = firstNonEmpty(a.deliveredSubject, b.deliveredSubject);
  return {
    ...a,
    ...b,
    // A send is the earliest moment we know about; a backfilled row may be later.
    at: compareTimestamps(a.at, b.at) <= 0 ? a.at : b.at,
    deliveredSubject: deliveredSubject ?? a.deliveredSubject ?? b.deliveredSubject ?? '',
    subjectTemplate: a.subjectTemplate ?? b.subjectTemplate ?? null,
    startsEpoch: a.startsEpoch === true || b.startsEpoch === true,
    conversationRootMessageId:
      normalizeMessageId(a.conversationRootMessageId) ??
      normalizeMessageId(b.conversationRootMessageId),
    emailMessageId: a.emailMessageId ?? b.emailMessageId ?? null,
    messageJobId: a.messageJobId ?? b.messageJobId ?? null,
    referenceMessageIds:
      (a.referenceMessageIds && a.referenceMessageIds.length > 0
        ? a.referenceMessageIds
        : b.referenceMessageIds) ?? null,
  };
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value != null && String(value).length > 0) return String(value);
  }
  return null;
}

function compareTimestamps(a: string, b: string): number {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return a < b ? -1 : a > b ? 1 : 0;
  return aTime - bTime;
}
