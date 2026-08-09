import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { SendWorker } from '../../../workers/send-worker/src/worker';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';
import type { ProcessedMessage } from '../../../workers/inbox-checker-worker/src/types';

function createProcessedMessage(overrides: Partial<ProcessedMessage> = {}): ProcessedMessage {
  return {
    uid: 123,
    messageId: `<reply-${randomUUID()}@example.com>`,
    inReplyTo: '<provider@example.com>',
    references: '<provider@example.com>',
    referenceMessageIds: ['provider@example.com'],
    threadTopic: null,
    threadIndex: null,
    from: { address: 'lead@example.com', name: 'Lead' },
    to: [{ address: 'sender@example.com', name: 'Sender' }],
    subject: 'Re: Render test',
    bodyText: 'Reply body',
    bodyHtml: '<p>Reply body</p>',
    date: new Date(),
    headers: {},
    attachments: [],
    ...overrides,
  };
}

test('rendered campaign content stays aligned through sent event persistence and inbox backfill', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('message-rendering'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Message Rendering Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'render-target',
          email: `lead-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('render-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const scheduledAt = new Date().toISOString();
    const messageJobId = randomUUID();

    const { error: jobError } = await harness.supabase.from('message_jobs').insert({
      id: messageJobId,
      enrollment_id: lead.enrollmentId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      lead_id: lead.leadId,
      mailbox_id: mailboxId,
      node_id: nodeId,
      status: 'reserved',
      scheduled_at: scheduledAt,
      reserved_at: scheduledAt,
      lease_expires_at: null,
      claim_token: null,
      sending_started_at: null,
      sent_at: null,
      provider_message_id: null,
      error_message: null,
      retry_count: 0,
      message_type: 'campaign',
      send_wait_reason: null,
      interval_id: null,
      message_data: {
        node_config: {
          subject: '{Hi {{first_name}}|Hello {{first_name}}}',
          body_html:
            '<p>{Hey|Hello} {{first_name}},</p><p>{Appreciate it|Thanks} for your time.</p>',
          body_text:
            '{Hey|Hello} {{first_name}},\n\n{Appreciate it|Thanks} for your time.',
        },
      },
    } as any);
    assert.equal(jobError, null);
    graph.manifest.messageJobIds.push(messageJobId);

    const sendWorker = new SendWorker({
      supabase: harness.supabase as any,
      databaseClient: {} as any,
      campaignEmailSender: async () => ({
        submittedMessageId: '<provider@example.com>',
        providerMessageId: '<provider@example.com>',
      }),
    });
    (sendWorker as any).smtpPool = {
      getTransporter: async () => ({}),
      markMessageSent: () => {},
      closeAll: async () => {},
    };

    const { data: messageJobRow, error: messageJobLoadError } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', messageJobId)
      .single();
    assert.equal(messageJobLoadError, null);

    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      await (sendWorker as any).processMessageJob(messageJobRow);
    } finally {
      Math.random = originalRandom;
    }

    const { data: mailboxRow, error: mailboxError } = await harness.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', mailboxId)
      .single();
    assert.equal(mailboxError, null);

    const threadManager = new ThreadManager(harness.supabase as any);
    const replyHandled = await threadManager.handleReply(
      mailboxRow as any,
      createProcessedMessage({
        inReplyTo: '<provider@example.com>',
        references: '<provider@example.com>',
        from: { address: `lead-${harness.namespace}@example.com`, name: 'Lead' },
        to: [{ address: `sender-${harness.namespace}@example.com`, name: 'Sender' }],
      })
    );
    assert.equal(replyHandled, true);

    const { data: sentEvent, error: sentEventError } = await harness.supabase
      .from('events')
      .select('event_data')
      .eq('message_job_id', messageJobId)
      .eq('event_type', 'sent')
      .single();
    assert.equal(sentEventError, null);

    const { data: sentThread, error: sentThreadError } = await harness.supabase
      .from('email_threads')
      .select('id')
      .eq('message_job_id', messageJobId)
      .single();
    assert.equal(sentThreadError, null);

    const { data: sentMessage, error: sentMessageError } = await harness.supabase
      .from('email_messages')
      .select('subject, body_text, body_html')
      .eq('thread_id', sentThread.id)
      .eq('direction', 'sent')
      .order('received_at', { ascending: true })
      .limit(1)
      .single();
    assert.equal(sentMessageError, null);

    const eventData = (sentEvent as any).event_data as Record<string, string | null>;
    assert.equal(eventData.sent_subject, 'Hi Casey');
    assert.equal(eventData.sent_body_html, 'Hey Casey,<br>Appreciate it for your time.');
    assert.equal(eventData.sent_body_text, 'Hey Casey, Appreciate it for your time.');

    assert.equal(sentMessage?.subject, 'Hi Casey');
    assert.equal(sentMessage?.body_html, 'Hey Casey,<br>Appreciate it for your time.');
    assert.equal(sentMessage?.body_text, 'Hey Casey, Appreciate it for your time.');
  } finally {
    await harness.cleanup();
  }
});

test('html-mode campaign content preserves full-document markup through sent persistence', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('message-rendering-html-mode'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Message Rendering HTML Mode Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'render-target',
          email: `lead-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('render-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const scheduledAt = new Date().toISOString();
    const messageJobId = randomUUID();

    const { error: jobError } = await harness.supabase.from('message_jobs').insert({
      id: messageJobId,
      enrollment_id: lead.enrollmentId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      lead_id: lead.leadId,
      mailbox_id: mailboxId,
      node_id: nodeId,
      status: 'reserved',
      scheduled_at: scheduledAt,
      reserved_at: scheduledAt,
      lease_expires_at: null,
      claim_token: null,
      sending_started_at: null,
      sent_at: null,
      provider_message_id: null,
      error_message: null,
      retry_count: 0,
      message_type: 'campaign',
      send_wait_reason: null,
      interval_id: null,
      message_data: {
        node_config: {
          subject: 'HTML mode for {{first_name}}',
          editor_mode: 'html',
          body_html:
            '<!DOCTYPE html><html><head><style>.hero{color:#fff}</style></head><body><table><tr><td class="hero">Hello {{first_name}}</td></tr></table></body></html>',
          body_text: 'Hello {{first_name}}',
        },
      },
    } as any);
    assert.equal(jobError, null);
    graph.manifest.messageJobIds.push(messageJobId);

    const sendWorker = new SendWorker({
      supabase: harness.supabase as any,
      databaseClient: {} as any,
      campaignEmailSender: async () => ({
        submittedMessageId: '<provider@example.com>',
        providerMessageId: '<provider@example.com>',
      }),
    });
    (sendWorker as any).smtpPool = {
      getTransporter: async () => ({}),
      markMessageSent: () => {},
      closeAll: async () => {},
    };

    const { data: messageJobRow, error: messageJobLoadError } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', messageJobId)
      .single();
    assert.equal(messageJobLoadError, null);

    await (sendWorker as any).processMessageJob(messageJobRow);

    const { data: sentEvent, error: sentEventError } = await harness.supabase
      .from('events')
      .select('event_data')
      .eq('message_job_id', messageJobId)
      .eq('event_type', 'sent')
      .single();
    assert.equal(sentEventError, null);

    const eventData = (sentEvent as any).event_data as Record<string, string | null>;
    assert.match(eventData.sent_body_html ?? '', /<html>/i);
    assert.match(eventData.sent_body_html ?? '', /<table>/i);
    assert.equal(eventData.sent_body_text, 'Hello Casey');
  } finally {
    await harness.cleanup();
  }
});

test('empty body_html with populated template still renders campaign copy (API/MCP shape)', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('message-rendering-empty-html'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Message Rendering Empty body_html Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'render-target',
          email: `lead-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('render-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const { error: signatureError } = await harness.supabase
      .from('mailboxes')
      .update({ signature: '<p>Thanks,<br>Porter</p>' })
      .eq('id', mailboxId);
    assert.equal(signatureError, null);
    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const scheduledAt = new Date().toISOString();
    const messageJobId = randomUUID();

    const { error: jobError } = await harness.supabase.from('message_jobs').insert({
      id: messageJobId,
      enrollment_id: lead.enrollmentId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      lead_id: lead.leadId,
      mailbox_id: mailboxId,
      node_id: nodeId,
      status: 'reserved',
      scheduled_at: scheduledAt,
      reserved_at: scheduledAt,
      lease_expires_at: null,
      claim_token: null,
      sending_started_at: null,
      sent_at: null,
      provider_message_id: null,
      error_message: null,
      retry_count: 0,
      message_type: 'campaign',
      send_wait_reason: null,
      interval_id: null,
      message_data: {
        node_config: {
          subject: 'thought this might help',
          body_html: '',
          template: 'Hey {{first_name}}, figured this might help.',
          body_text: 'Hey {{first_name}}, figured this might help.',
          body: 'Hey {{first_name}}, figured this might help.',
        },
      },
    } as any);
    assert.equal(jobError, null);
    graph.manifest.messageJobIds.push(messageJobId);

    let capturedSmtpBody: string | null = null;
    const sendWorker = new SendWorker({
      supabase: harness.supabase as any,
      databaseClient: {} as any,
      campaignEmailSender: async (
        _transporter,
        _mailbox,
        _job,
        _lead,
        _subject,
        body,
        _inReplyTo,
        _references,
        options
      ) => {
        capturedSmtpBody = options?.bodyHtml ?? body;
        return {
          submittedMessageId: '<provider@example.com>',
          providerMessageId: '<provider@example.com>',
        };
      },
    });
    (sendWorker as any).smtpPool = {
      getTransporter: async () => ({}),
      markMessageSent: () => {},
      closeAll: async () => {},
    };

    const { data: messageJobRow, error: messageJobLoadError } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', messageJobId)
      .single();
    assert.equal(messageJobLoadError, null);

    await (sendWorker as any).processMessageJob(messageJobRow);

    const { data: sentEvent, error: sentEventError } = await harness.supabase
      .from('events')
      .select('event_data')
      .eq('message_job_id', messageJobId)
      .eq('event_type', 'sent')
      .single();
    assert.equal(sentEventError, null);

    const eventData = (sentEvent as any).event_data as Record<string, string | null>;
    assert.match(eventData.sent_body_html ?? '', /Hey Casey, figured this might help/);
    assert.match(eventData.sent_body_html ?? '', /Thanks,<br\s*\/?>Porter/);
    assert.match(eventData.sent_body_text ?? '', /Hey Casey, figured this might help/);
    assert.match(capturedSmtpBody ?? '', /Hey Casey, figured this might help/);
  } finally {
    await harness.cleanup();
  }
});

test('SMTP capture has semantic text/html parity and no unresolved subject templates', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('message-rendering-mime'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Message Rendering MIME Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'mime-target',
          email: `lead-mime-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('mime-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const scheduledAt = new Date().toISOString();
    const messageJobId = randomUUID();

    const { error: jobError } = await harness.supabase.from('message_jobs').insert({
      id: messageJobId,
      enrollment_id: lead.enrollmentId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      lead_id: lead.leadId,
      mailbox_id: mailboxId,
      node_id: nodeId,
      status: 'reserved',
      scheduled_at: scheduledAt,
      reserved_at: scheduledAt,
      lease_expires_at: null,
      claim_token: null,
      sending_started_at: null,
      sent_at: null,
      provider_message_id: null,
      error_message: null,
      retry_count: 0,
      message_type: 'campaign',
      send_wait_reason: null,
      interval_id: null,
      message_data: {
        node_config: {
          subject: 'MIME parity {{first_name}}',
          body_html: '<p>Hello {{first_name}}</p><p>Thanks</p>',
          body_text: 'Hello {{first_name}}\n\nThanks',
        },
      },
    } as any);
    assert.equal(jobError, null);
    graph.manifest.messageJobIds.push(messageJobId);

    let capturedSubject = '';
    let capturedText: string | null = null;
    let capturedHtml: string | null = null;
    const sendWorker = new SendWorker({
      supabase: harness.supabase as any,
      databaseClient: {} as any,
      campaignEmailSender: async (
        _t,
        _m,
        job: { id: string },
        _l,
        subject,
        body,
        _irt,
        _refs,
        options?: { bodyHtml?: string; bodyText?: string },
      ) => {
        capturedSubject = String(subject ?? '');
        capturedHtml = options?.bodyHtml ?? null;
        capturedText = options?.bodyText ?? (options?.bodyHtml ? null : String(body ?? ''));
        return {
          submittedMessageId: `<${job.id}@furnace.build>`,
          providerMessageId: `<${job.id}@furnace.build>`,
        };
      },
    });
    (sendWorker as any).smtpPool = {
      getTransporter: async () => ({}),
      markMessageSent: () => {},
      closeAll: async () => {},
    };

    const { data: messageJobRow } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', messageJobId)
      .single();
    await (sendWorker as any).processMessageJob(messageJobRow);

    const { assertMimeSemanticParity, assertNoUnresolvedTemplate } = await import(
      '../inbox/threadingAssertions'
    );
    assertNoUnresolvedTemplate(capturedSubject, 'SMTP subject');
    assert.equal(capturedSubject, 'MIME parity Casey');
    assertMimeSemanticParity(capturedText, capturedHtml, 'SMTP body parts');
  } finally {
    await harness.cleanup();
  }
});
