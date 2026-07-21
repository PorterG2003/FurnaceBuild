import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { buildInboxAttachmentStoragePath } from '../lib/inbox/attachmentStoragePath';
import { INBOX_ATTACHMENTS_BUCKET } from '../lib/inbox/attachmentStoragePath';

config({ path: '.env.local' });

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
// Prefer the campaign-test account that already has furnaceoutbound + porter@getfurnace.io
const accountId =
  process.env.SMOKE_ACCOUNT_ID ||
  process.env.SEED_ACCOUNT_ID ||
  '01e27f5c-6a28-4c08-9abf-2576a199f70f';
const leadEmail = 'porter@getfurnace.io';

if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key);

async function main() {
  // Ensure migration surfaces exist
  const { error: tableErr } = await supabase.from('inbox_attachment_uploads').select('id').limit(1);
  if (tableErr) {
    throw new Error(
      `inbox_attachment_uploads missing — apply migration first: ${tableErr.message}`
    );
  }

  // Prefer porterg@furnaceoutbound.com when present
  const { data: preferredMailbox } = await supabase
    .from('mailboxes')
    .select('id, email_address, display_name, account_id')
    .eq('account_id', accountId)
    .eq('email_address', 'porterg@furnaceoutbound.com')
    .eq('status', 'connected')
    .is('deleted_at', null)
    .maybeSingle();

  let mailbox = preferredMailbox;
  if (!mailbox) {
    const { data: fallback, error: mailboxErr } = await supabase
      .from('mailboxes')
      .select('id, email_address, display_name, account_id')
      .eq('account_id', accountId)
      .eq('status', 'connected')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mailboxErr || !fallback) throw new Error(`No connected mailbox: ${mailboxErr?.message}`);
    mailbox = fallback;
  }

  const { data: existingLead, error: leadLookupErr } = await supabase
    .from('leads')
    .select('id, campaign_id')
    .eq('account_id', accountId)
    .eq('email', leadEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (leadLookupErr || !existingLead?.id) {
    throw new Error(
      `Need existing lead ${leadEmail} on account ${accountId}: ${leadLookupErr?.message || 'not found'}`
    );
  }
  const leadId = existingLead.id;
  const campaignId = existingLead.campaign_id || null;

  const threadId = randomUUID();
  const campaignMsgId = `<smoke-campaign-${Date.now()}@furnace.test>`;
  const replyMsgId = `<smoke-reply-${Date.now()}@furnace.test>`;
  const subject = 'Attachment smoke test — please download the PDF';
  const now = new Date();
  const campaignAt = new Date(now.getTime() - 60_000).toISOString();
  const replyAt = now.toISOString();

  const { error: threadErr } = await supabase.from('email_threads').insert({
    id: threadId,
    account_id: accountId,
    mailbox_id: mailbox.id,
    lead_id: leadId,
    campaign_id: campaignId,
    subject,
    participants: [mailbox.email_address, leadEmail],
    message_count: 2,
    last_message_at: replyAt,
    last_inbound_at: replyAt,
    conversation_status: 'open',
    has_reply: false,
  });
  if (threadErr) throw new Error(`Create thread failed: ${threadErr.message}`);

  const { data: campaignMsg, error: campMsgErr } = await supabase
    .from('email_messages')
    .insert({
      thread_id: threadId,
      account_id: accountId,
      direction: 'sent',
      from_email: mailbox.email_address,
      from_name: mailbox.display_name,
      to_email: leadEmail,
      to_name: 'Porter Gardiner',
      subject,
      body_text:
        'Hey Porter — this is a campaign-style first touch for the attachment download smoke test.',
      body_html:
        '<p>Hey Porter — this is a campaign-style first touch for the attachment download smoke test.</p>',
      message_id: campaignMsgId,
      received_at: campaignAt,
      attachments: [],
    })
    .select('id')
    .single();
  if (campMsgErr || !campaignMsg) {
    throw new Error(`Campaign message insert failed: ${campMsgErr?.message}`);
  }

  // Build a tiny PDF bytes (minimal valid-ish PDF)
  const pdfText = '%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nSmoke attachment for inbox download QA.\n';
  const pdfBytes = Buffer.from(pdfText, 'utf8');
  const filename = 'furnace-attachment-smoke.pdf';
  const uploadId = randomUUID();
  const storagePath = buildInboxAttachmentStoragePath({
    accountId,
    threadId,
    uploadId,
    filename,
  });

  const { error: upErr } = await supabase.storage.from(INBOX_ATTACHMENTS_BUCKET).upload(storagePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { error: uploadRowErr } = await supabase.from('inbox_attachment_uploads').insert({
    account_id: accountId,
    thread_id: threadId,
    storage_path: storagePath,
    filename,
    content_type: 'application/pdf',
    size: pdfBytes.length,
    status: 'sent',
    sent_at: replyAt,
  });
  if (uploadRowErr) throw new Error(`Upload row insert failed: ${uploadRowErr.message}`);

  const { data: replyMsg, error: replyErr } = await supabase
    .from('email_messages')
    .insert({
      thread_id: threadId,
      account_id: accountId,
      direction: 'sent',
      from_email: mailbox.email_address,
      from_name: mailbox.display_name,
      to_email: leadEmail,
      to_name: 'Porter Gardiner',
      subject: `Re: ${subject}`,
      body_text:
        'Attaching a small PDF for smoke testing Storage-backed sent attachment download. Open this thread in Inbox and download the PDF.',
      body_html:
        '<p>Attaching a small PDF for smoke testing Storage-backed sent attachment download. Open this thread in Inbox and download the PDF.</p>',
      message_id: replyMsgId,
      in_reply_to: campaignMsgId,
      received_at: replyAt,
      attachments: [
        {
          filename,
          contentType: 'application/pdf',
          size: pdfBytes.length,
          storagePath,
        },
      ],
    })
    .select('id')
    .single();
  if (replyErr || !replyMsg) throw new Error(`Reply insert failed: ${replyErr?.message}`);

  const out = {
    accountId,
    mailbox: mailbox.email_address,
    leadEmail,
    threadId,
    campaignMessageId: campaignMsg.id,
    replyMessageId: replyMsg.id,
    storagePath,
    filename,
    inboxUrl: `https://build.getfurnace.io/inbox/${threadId}`,
    localInboxPath: `/inbox/${threadId}`,
  };
  mkdirSync(dirname('tmp/attachment-smoke-thread.json'), { recursive: true });
  writeFileSync('tmp/attachment-smoke-thread.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
