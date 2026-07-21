import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { ClientApiDbHarness, createClientApiTestNamespace } from '../client-api/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
} from '../campaign/fixtures';
import { buildInboxAttachmentStoragePath } from '../../inbox/attachmentStoragePath';
import { canDownloadAttachment } from '../../inbox/attachmentStoragePath';

const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.SUPABASE_ANON_KEY?.trim();

function skipIfAttachmentMigrationUnavailable(
  t: { skip: (message?: string) => never },
  error: { code?: string | null; message?: string | null } | null | undefined
) {
  if (!error) return false;
  const msg = error.message ?? '';
  if (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('inbox_attachment_uploads') ||
    msg.includes('validate_and_claim_inbox_attachments')
  ) {
    t.skip('Inbox attachment storage migration is not applied in the target test database yet.');
  }
  return false;
}

async function createOwnerClient(harness: ClientApiDbHarness) {
  const ownerToken = await harness.getOwnerAccessToken();
  return createClient(harness.env.supabaseUrl, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ownerToken}` } },
  });
}

test('sentAttachmentStorageOutcomes: thin reply job claims uploads and rejects base64', async (t) => {
  if (!publishableKey) {
    t.skip('Missing publishable/anon key for authenticated RPC outcomes.');
  }

  const namespace = createClientApiTestNamespace('sent-att');
  const harness = new ClientApiDbHarness(namespace);
  await harness.setup();

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Sent attachment storage',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'lead-1',
          email: `sent-att-${namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            attachReplyThread: true,
          }),
          thread: buildCampaignThread({
            subject: 'Attachment thread',
            hasReply: true,
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date().toISOString(),
                messageId: `<recv-${namespace}@furnace.test>`,
              }),
            ],
          }),
        }),
      ],
    });

    const accountId = graph.accountId;
    const lead = graph.leadsByKey.get('lead-1');
    const threadId = lead?.threadId;
    const messageId = graph.manifest.messageIds[0];
    assert.ok(accountId && threadId && messageId);

    const storagePath = buildInboxAttachmentStoragePath({
      accountId,
      threadId,
      uploadId: `up-${namespace}`,
      filename: 'note.txt',
    });

    const { error: uploadInsertError } = await harness.supabase.from('inbox_attachment_uploads').insert({
      account_id: accountId,
      thread_id: threadId,
      storage_path: storagePath,
      filename: 'note.txt',
      content_type: 'text/plain',
      size: 2,
      status: 'pending',
    });
    if (skipIfAttachmentMigrationUnavailable(t, uploadInsertError)) return;
    assert.equal(uploadInsertError, null);

    const owner = await createOwnerClient(harness);

    const { data: jobId, error: jobError } = await owner.rpc('create_inbox_reply_job', {
      p_account_id: accountId,
      p_thread_id: threadId,
      p_in_reply_to_message_id: messageId,
      p_subject: 'Re: Attachment thread',
      p_body_text: 'Here is the file',
      p_body_html: '<p>Here is the file</p>',
      p_to_email: `sent-att-${namespace}@furnace.test`,
      p_to_name: null,
      p_cc: null,
      p_attachments: [
        {
          filename: 'note.txt',
          contentType: 'text/plain',
          size: 2,
          storagePath,
        },
      ],
    });
    if (skipIfAttachmentMigrationUnavailable(t, jobError)) return;
    assert.equal(jobError, null);
    assert.ok(typeof jobId === 'string');

    const { data: job } = await harness.supabase
      .from('message_jobs')
      .select('message_data')
      .eq('id', jobId)
      .single();
    const attachments = (job?.message_data as { attachments?: Array<Record<string, unknown>> })?.attachments ?? [];
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].storagePath, storagePath);
    assert.equal(attachments[0].content, undefined);

    const { data: uploadRow } = await harness.supabase
      .from('inbox_attachment_uploads')
      .select('status')
      .eq('storage_path', storagePath)
      .single();
    assert.equal(uploadRow?.status, 'claimed');

    const { error: fatError } = await owner.rpc('create_inbox_reply_job', {
      p_account_id: accountId,
      p_thread_id: threadId,
      p_in_reply_to_message_id: messageId,
      p_subject: 'Re: fat',
      p_body_text: 'nope',
      p_body_html: '<p>nope</p>',
      p_to_email: `sent-att-${namespace}@furnace.test`,
      p_to_name: null,
      p_cc: null,
      p_attachments: [
        {
          filename: 'bad.txt',
          contentType: 'text/plain',
          content: Buffer.from('x').toString('base64'),
        },
      ],
    });
    assert.ok(fatError);
    assert.match(fatError.message ?? '', /storagePath|base64|content/i);

    assert.equal(
      canDownloadAttachment({
        filename: 'note.txt',
        contentType: 'text/plain',
        size: 2,
        storagePath,
      }),
      true
    );

    // Message delete should enqueue GC path after we attach storagePath on a message row.
    const { data: insertedMessage, error: insertMsgError } = await harness.supabase
      .from('email_messages')
      .insert({
        thread_id: threadId,
        account_id: accountId,
        direction: 'sent',
        from_email: 'sender@furnace.test',
        to_email: `sent-att-${namespace}@furnace.test`,
        subject: 'with attachment',
        body_text: 'x',
        message_id: `<sent-att-${namespace}@furnace.test>`,
        received_at: new Date().toISOString(),
        attachments: [
          {
            filename: 'note.txt',
            contentType: 'text/plain',
            size: 2,
            storagePath,
          },
        ],
      })
      .select('id')
      .single();
    assert.equal(insertMsgError, null);
    assert.ok(insertedMessage?.id);

    const { error: deleteError } = await harness.supabase
      .from('email_messages')
      .delete()
      .eq('id', insertedMessage!.id);
    assert.equal(deleteError, null);

    const { data: gcRow } = await harness.supabase
      .from('inbox_attachment_gc_queue')
      .select('storage_path, reason')
      .eq('storage_path', storagePath)
      .maybeSingle();
    assert.equal(gcRow?.storage_path, storagePath);
    assert.equal(gcRow?.reason, 'message_deleted');
  } finally {
    await harness.cleanup();
  }
});

test('sentAttachmentStorageOutcomes: forward job claims uploads (parity)', async (t) => {
  if (!publishableKey) {
    t.skip('Missing publishable/anon key for authenticated RPC outcomes.');
  }

  const namespace = createClientApiTestNamespace('sent-fwd');
  const harness = new ClientApiDbHarness(namespace);
  await harness.setup();

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Sent attachment forward',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'lead-1',
          email: `sent-fwd-${namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            attachReplyThread: true,
          }),
          thread: buildCampaignThread({
            subject: 'Forward attachment thread',
            hasReply: true,
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date().toISOString(),
                messageId: `<recv-fwd-${namespace}@furnace.test>`,
              }),
            ],
          }),
        }),
      ],
    });

    const accountId = graph.accountId;
    const lead = graph.leadsByKey.get('lead-1');
    const threadId = lead?.threadId;
    const messageId = graph.manifest.messageIds[0];
    assert.ok(accountId && threadId && messageId);

    const storagePath = buildInboxAttachmentStoragePath({
      accountId,
      threadId,
      uploadId: `fwd-${namespace}`,
      filename: 'doc.pdf',
    });

    const { error: uploadInsertError } = await harness.supabase.from('inbox_attachment_uploads').insert({
      account_id: accountId,
      thread_id: threadId,
      storage_path: storagePath,
      filename: 'doc.pdf',
      content_type: 'application/pdf',
      size: 4,
      status: 'pending',
    });
    if (skipIfAttachmentMigrationUnavailable(t, uploadInsertError)) return;
    assert.equal(uploadInsertError, null);

    const owner = await createOwnerClient(harness);
    const { data: jobId, error: jobError } = await owner.rpc('create_inbox_forward_job', {
      p_account_id: accountId,
      p_thread_id: threadId,
      p_forwarded_message_id: messageId,
      p_subject: 'Fwd: docs',
      p_body_text: 'forwarded',
      p_body_html: '<p>forwarded</p>',
      p_to_email: 'someone@example.com',
      p_to_name: null,
      p_cc: null,
      p_attachments: [
        {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
          size: 4,
          storagePath,
        },
      ],
    });
    if (skipIfAttachmentMigrationUnavailable(t, jobError)) return;
    assert.equal(jobError, null);
    assert.ok(jobId);

    const { data: uploadRow } = await harness.supabase
      .from('inbox_attachment_uploads')
      .select('status')
      .eq('storage_path', storagePath)
      .single();
    assert.equal(uploadRow?.status, 'claimed');
  } finally {
    await harness.cleanup();
  }
});

test('sentAttachmentStorageOutcomes: enqueue expired pending uploads for GC', async (t) => {
  const namespace = createClientApiTestNamespace('sent-ttl');
  const harness = new ClientApiDbHarness(namespace);
  await harness.setup();

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Sent attachment TTL',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'lead-1',
          email: `sent-ttl-${namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            attachReplyThread: true,
          }),
          thread: buildCampaignThread({
            subject: 'TTL thread',
            hasReply: false,
            messages: [],
          }),
        }),
      ],
    });

    const accountId = graph.accountId;
    const threadId = graph.leadsByKey.get('lead-1')?.threadId;
    assert.ok(accountId && threadId);

    const storagePath = buildInboxAttachmentStoragePath({
      accountId,
      threadId,
      uploadId: `ttl-${namespace}`,
      filename: 'stale.txt',
    });

    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { error: uploadInsertError } = await harness.supabase.from('inbox_attachment_uploads').insert({
      account_id: accountId,
      thread_id: threadId,
      storage_path: storagePath,
      filename: 'stale.txt',
      content_type: 'text/plain',
      size: 1,
      status: 'pending',
      created_at: old,
    });
    if (skipIfAttachmentMigrationUnavailable(t, uploadInsertError)) return;
    assert.equal(uploadInsertError, null);

    const { data: count, error: enqueueError } = await harness.supabase.rpc(
      'enqueue_expired_pending_inbox_attachments',
      { p_older_than_hours: 24 }
    );
    if (skipIfAttachmentMigrationUnavailable(t, enqueueError)) return;
    assert.equal(enqueueError, null);
    assert.ok(typeof count === 'number');
    assert.ok(count >= 1);

    const { data: gcRow } = await harness.supabase
      .from('inbox_attachment_gc_queue')
      .select('reason')
      .eq('storage_path', storagePath)
      .maybeSingle();
    assert.equal(gcRow?.reason, 'unclaimed_ttl');

    const { data: uploadRow } = await harness.supabase
      .from('inbox_attachment_uploads')
      .select('id')
      .eq('storage_path', storagePath)
      .maybeSingle();
    assert.equal(uploadRow, null);
  } finally {
    await harness.cleanup();
  }
});
