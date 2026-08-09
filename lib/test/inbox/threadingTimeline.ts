/**
 * Timeline builders for threading outcome tests.
 * Prefer explicit ISO timestamps so mixed inbound/outbound order is deterministic.
 */
import { randomUUID } from 'node:crypto';
import type {
  CampaignMessageJobSpec,
  CampaignThreadMessageSpec,
} from '../campaign/harness';
import { buildCampaignJob, buildThreadMessage } from '../campaign/fixtures';

export type ThreadingTimelineSend = {
  key: string;
  at: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  messageType?: CampaignMessageJobSpec['messageType'];
  providerMessageId?: string;
  /** When true, omit events.sent / leave sent_subject unset (imported/legacy). */
  importedWithoutEvent?: boolean;
  nodeConfigSubject?: string;
  sentSubject?: string | null;
  nodeFlowNodeId?: string | null;
};

export type ThreadingTimelineReceive = {
  key: string;
  at: string;
  subject: string;
  bodyText?: string;
  inReplyTo?: string | null;
  messageId?: string;
  messageReferences?: string | null;
};

export function isoOffset(baseMs: number, offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

export function buildTimelineBase(now = Date.now()): number {
  return now;
}

/**
 * Build a reserved/sent campaign job spec with explicit timestamps and
 * optional imported (no sent_subject / no event) shape.
 */
export function buildTimelineSentJob(
  send: ThreadingTimelineSend,
): CampaignMessageJobSpec {
  const providerMessageId =
    send.providerMessageId ?? `<${send.key}-${randomUUID().slice(0, 8)}@furnace.test>`;
  const nodeSubject = send.nodeConfigSubject ?? send.subject;
  const messageData: Record<string, unknown> = {
    source: send.importedWithoutEvent ? 'imported_seed' : 'campaign_seed',
    node_config: {
      subject: nodeSubject,
      body_html: send.bodyHtml ?? `<p>${send.bodyText ?? 'Body'}</p>`,
      body_text: send.bodyText ?? 'Body',
    },
  };
  if (send.sentSubject !== undefined && send.sentSubject !== null) {
    messageData.sent_subject = send.sentSubject;
  } else if (!send.importedWithoutEvent && send.subject !== '') {
    // Default: persist rendered subject for non-imported sends.
    messageData.sent_subject = send.subject;
  }

  return buildCampaignJob({
    key: send.key,
    status: 'sent',
    scheduledAt: send.at,
    sentAt: send.at,
    providerMessageId,
    messageType: send.messageType ?? 'campaign',
    nodeFlowNodeId: send.nodeFlowNodeId === undefined ? 'email-1' : send.nodeFlowNodeId,
    messageData,
  });
}

export function buildTimelineReceivedMessage(
  recv: ThreadingTimelineReceive,
): CampaignThreadMessageSpec {
  return buildThreadMessage({
    direction: 'received',
    subject: recv.subject,
    bodyText: recv.bodyText ?? 'Inbound reply',
    bodyHtml: `<p>${recv.bodyText ?? 'Inbound reply'}</p>`,
    receivedAt: recv.at,
    readAt: null,
    messageId: recv.messageId ?? `inbound-${recv.key}@mail.example.com`,
    inReplyTo: recv.inReplyTo ?? null,
    messageReferences: recv.messageReferences ?? recv.inReplyTo ?? null,
  });
}

export function buildTimelineSentMessage(
  send: ThreadingTimelineSend,
): CampaignThreadMessageSpec {
  return buildThreadMessage({
    direction: 'sent',
    subject: send.subject,
    bodyText: send.bodyText ?? 'Outbound',
    bodyHtml: send.bodyHtml ?? `<p>${send.bodyText ?? 'Outbound'}</p>`,
    receivedAt: send.at,
    readAt: send.at,
    messageId: send.providerMessageId ?? null,
    inReplyTo: null,
    messageReferences: null,
  });
}

/** Chad-shaped anonymized incident timeline keys (for documentation / seeds). */
export const CHAD_SHAPED_TIMELINE = {
  emptyRoot: 'empty-root',
  blankContinuation: 'blank-continuation',
  explicitSubject: 'explicit-subject',
  inbound1: 'inbound-1',
  priority1: 'priority-1',
  inbound2: 'inbound-2',
  priority2: 'priority-2',
  manualReply: 'manual-reply',
} as const;
