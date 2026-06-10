import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { CampaignDbHarness } from './harness';
import { SchedulerWorker } from '../../../workers/scheduler-worker/src/worker';
import { DatabaseClient as SchedulerDatabaseClient } from '../../../workers/scheduler-worker/src/database';
import { SendWorker } from '../../../workers/send-worker/src/worker';
import { DatabaseClient as SendDatabaseClient } from '../../../workers/send-worker/src/database';
import type {
  CategorizerLlmTransport,
  CategorizerCategory,
} from '../../../workers/scheduler-worker/src/categorizer/classify';
import type {
  Mailbox as InboxMailbox,
  ProcessedMessage,
} from '../../../workers/inbox-checker-worker/src/types';

/**
 * Shared seams for categorizer integration tests: scripted LLM transport,
 * synthetic inbound replies (real + auto-reply headers), and worker factories
 * matching the production wiring.
 */

// ---------------------------------------------------------------------------
// Scripted LLM transport
// ---------------------------------------------------------------------------

export type ScriptedLlmStep =
  | { kind: 'classify'; category: CategorizerCategory; returnDate?: string | null }
  | { kind: 'fail'; details: string; httpStatus?: number }
  | { kind: 'garbage'; text: string }
  | { kind: 'throw'; message: string };

export interface ScriptedTransportCall {
  model: string;
  system: string;
  user: string;
}

export interface ScriptedCategorizerTransport {
  transport: CategorizerLlmTransport;
  calls: ScriptedTransportCall[];
  /** Append more steps mid-test. */
  push: (...steps: ScriptedLlmStep[]) => void;
}

/**
 * Consumes one scripted step per LLM call, in order. Throws if called more
 * times than scripted, so tests catch unexpected extra LLM traffic.
 */
export function createScriptedCategorizerTransport(
  steps: ScriptedLlmStep[] = [],
): ScriptedCategorizerTransport {
  const queue = [...steps];
  const calls: ScriptedTransportCall[] = [];

  const transport: CategorizerLlmTransport = async (params) => {
    calls.push({ model: params.model, system: params.system, user: params.user });
    const step = queue.shift();
    if (!step) {
      throw new Error(
        `Scripted categorizer transport exhausted (call #${calls.length}); test made more LLM calls than scripted`,
      );
    }
    switch (step.kind) {
      case 'classify':
        return {
          ok: true,
          text: JSON.stringify({
            category: step.category,
            return_date: step.returnDate ?? null,
          }),
        };
      case 'garbage':
        return { ok: true, text: step.text };
      case 'fail':
        return { ok: false, details: step.details, httpStatus: step.httpStatus };
      case 'throw':
        throw new Error(step.message);
    }
  };

  return {
    transport,
    calls,
    push: (...more) => {
      queue.push(...more);
    },
  };
}

// ---------------------------------------------------------------------------
// Synthetic inbound messages
// ---------------------------------------------------------------------------

export function buildProcessedReply(params: {
  leadEmail: string;
  mailboxEmail: string;
  inReplyTo: string | null;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
  autoReply?: boolean;
  date?: Date;
  references?: string | null;
  headers?: Record<string, string | string[] | undefined>;
}): ProcessedMessage {
  const bodyText = params.bodyText ?? 'Reply body';
  return {
    uid: Math.floor(Math.random() * 1_000_000),
    messageId: `<reply-${randomUUID()}@furnace.test>`,
    inReplyTo: params.inReplyTo,
    references: params.references ?? params.inReplyTo,
    from: { address: params.leadEmail, name: 'Test Lead' },
    to: [{ address: params.mailboxEmail, name: 'Test Mailbox' }],
    subject: params.subject ?? 'Re: Quick check-in',
    bodyText,
    bodyHtml: params.bodyHtml === undefined ? `<p>${bodyText}</p>` : params.bodyHtml,
    date: params.date ?? new Date(),
    headers: {
      ...(params.autoReply ? { 'auto-submitted': 'auto-replied' } : {}),
      ...(params.headers ?? {}),
    },
    attachments: [],
  };
}

// ---------------------------------------------------------------------------
// Worker factories (production wiring, injectable seams only)
// ---------------------------------------------------------------------------

export function createTestSchedulerWorker(
  harness: CampaignDbHarness,
  options?: { classifyTransport?: CategorizerLlmTransport },
): SchedulerWorker {
  return new SchedulerWorker({
    supabase: harness.supabase as any,
    databaseClient: new SchedulerDatabaseClient({
      supabase: harness.supabase as any,
      batchSize: 500,
      pollIntervalMs: 1000,
    }) as any,
    categorizerClassifyTransport: options?.classifyTransport,
  });
}

export function createTestSendWorker(
  harness: CampaignDbHarness,
  options?: {
    failingJobIds?: Set<string>;
    onSend?: (jobId: string) => void;
  },
): SendWorker {
  const sendWorker = new SendWorker({
    supabase: harness.supabase as any,
    databaseClient: new SendDatabaseClient({
      supabase: harness.supabase as any,
      batchSize: 100,
      pollIntervalMs: 1000,
    }) as any,
    campaignEmailSender: async (_transporter: unknown, _mailbox: unknown, job: any) => {
      if (options?.failingJobIds?.has(job.id)) {
        throw new Error('Synthetic provider failure');
      }
      options?.onSend?.(job.id);
      return `<${job.id}@furnace.test>`;
    },
  });
  (sendWorker as any).smtpPool = {
    getTransporter: async () => ({}),
    closeAll: async () => {},
  };
  return sendWorker;
}

/**
 * Run the scheduler claim path for specific enrollments, mirroring the
 * production grouping/context flow (same approach as campaignLifecycleOutcomes).
 */
export async function processEnrollmentIds(
  harness: CampaignDbHarness,
  worker: SchedulerWorker,
  enrollmentIds: string[],
): Promise<void> {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('*')
    .in('id', enrollmentIds);
  assert.equal(error, null);
  const enrollments = (data ?? []) as any[];
  const grouped = (worker as any).groupEnrollmentsByCampaign(enrollments);
  const contexts = await (worker as any).loadCampaignContexts(grouped);
  for (const enrollment of enrollments) {
    await (worker as any).processEnrollment(enrollment, contexts.get(enrollment.campaign_id));
  }
}

export async function getEnrollmentRow(
  harness: CampaignDbHarness,
  enrollmentId: string,
): Promise<any> {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('*')
    .eq('id', enrollmentId)
    .single();
  assert.equal(error, null);
  return data;
}

export async function getThreadRow(harness: CampaignDbHarness, threadId: string): Promise<any> {
  const { data, error } = await harness.supabase
    .from('email_threads')
    .select('*')
    .eq('id', threadId)
    .single();
  assert.equal(error, null);
  return data;
}

export async function getJobsForEnrollment(
  harness: CampaignDbHarness,
  enrollmentId: string,
): Promise<any[]> {
  const { data, error } = await harness.supabase
    .from('message_jobs')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: true });
  assert.equal(error, null);
  return (data ?? []) as any[];
}

export async function getMailboxRow(
  harness: CampaignDbHarness,
  mailboxId: string,
): Promise<InboxMailbox> {
  const { data, error } = await harness.supabase
    .from('mailboxes')
    .select('*')
    .eq('id', mailboxId)
    .single();
  assert.equal(error, null);
  return data as InboxMailbox;
}
