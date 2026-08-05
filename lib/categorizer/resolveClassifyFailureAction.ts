/** Max SQS ApproximateReceiveCount before classifyReply stops retrying. */
export const CLASSIFY_REPLY_MAX_ATTEMPTS = 3;

export type ClassifyFailureAction = 'retry' | 'give_up';

/**
 * Pure SQS retry policy for classifyReply failures.
 * receiveCount 1–2 → retry; ≥3 → give up (ack + Slack).
 */
export function resolveClassifyFailureAction(receiveCount: number): ClassifyFailureAction {
  const count = Number.isFinite(receiveCount) ? Math.max(0, Math.floor(receiveCount)) : 0;
  return count >= CLASSIFY_REPLY_MAX_ATTEMPTS ? 'give_up' : 'retry';
}

export function parseSqsApproximateReceiveCount(
  attributes: { ApproximateReceiveCount?: string } | null | undefined,
): number {
  const raw = attributes?.ApproximateReceiveCount;
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
