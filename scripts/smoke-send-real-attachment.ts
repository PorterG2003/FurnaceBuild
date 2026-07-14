/**
 * Fix the bogus smoke PDF in Storage, then SMTP-send a real valid PDF
 * from porerg@furnaceoutbound.com → porter@getfurnace.io so inbox + mailbox
 * can both be checked.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import {
  buildInboxAttachmentStoragePath,
  INBOX_ATTACHMENTS_BUCKET,
} from '../lib/inbox/attachmentStoragePath';

const require = createRequire(import.meta.url);
const nodemailer = require('../workers/send-worker/node_modules/nodemailer') as typeof import('nodemailer');

config({ path: '.env.local' });

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const accountId = '01e27f5c-6a28-4c08-9abf-2576a199f70f';
const mailboxId = '0e7d8c4b-397c-46a3-a7e1-95215673524b';
const leadEmail = 'porter@getfurnace.io';
const smokeThreadId = 'f205b722-a90e-4f1f-a870-88fa30b009c7';
const smokeReplyMessageId = 'e3c22a55-5be8-4958-b4e1-8d20d048a673';
const smokeStoragePath =
  '01e27f5c-6a28-4c08-9abf-2576a199f70f/f205b722-a90e-4f1f-a870-88fa30b009c7/952f9006-f6b4-41ba-a491-e11c707f1be5/furnace-attachment-smoke.pdf';

if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key);

async function main() {
  const pdfBytes = readFileSync('tmp/furnace-attachment-smoke.pdf');
  const filename = 'furnace-attachment-smoke.pdf';

  // 1) Replace the fake PDF on the existing smoke thread so Inbox redownload opens.
  const { error: upErr } = await supabase.storage
    .from(INBOX_ATTACHMENTS_BUCKET)
    .upload(smokeStoragePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) throw new Error(`Storage replace failed: ${upErr.message}`);

  await supabase
    .from('inbox_attachment_uploads')
    .update({ size: pdfBytes.length, content_type: 'application/pdf' })
    .eq('storage_path', smokeStoragePath);

  await supabase
    .from('email_messages')
    .update({
      attachments: [
        {
          filename,
          contentType: 'application/pdf',
          size: pdfBytes.length,
          storagePath: smokeStoragePath,
        },
      ],
    })
    .eq('id', smokeReplyMessageId);

  // 2) Real SMTP send so porter@getfurnace.io receives a readable PDF.
  const { data: mailbox, error: mbErr } = await supabase
    .from('mailboxes')
    .select(
      'id, email_address, display_name, smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, smtp_use_ssl'
    )
    .eq('id', mailboxId)
    .single();
  if (mbErr || !mailbox) throw new Error(`Mailbox load failed: ${mbErr?.message}`);

  const transporter = nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: !!mailbox.smtp_use_ssl,
    requireTLS: !!mailbox.smtp_use_tls && !mailbox.smtp_use_ssl,
    auth: {
      user: mailbox.smtp_username,
      pass: mailbox.smtp_password,
    },
  });

  const subject = `Attachment smoke (live SMTP) ${new Date().toISOString().slice(0, 19)}`;
  const messageId = `<smoke-live-${Date.now()}@furnaceoutbound.com>`;

  const info = await transporter.sendMail({
    from: mailbox.display_name
      ? `"${mailbox.display_name}" <${mailbox.email_address}>`
      : mailbox.email_address,
    to: leadEmail,
    subject,
    text:
      'Live SMTP smoke: open this PDF. If it opens here, Inbox download of the same bytes should also open.',
    html:
      '<p>Live SMTP smoke: open this PDF. If it opens here, Inbox download of the same bytes should also open.</p>',
    messageId,
    attachments: [
      {
        filename,
        contentType: 'application/pdf',
        content: pdfBytes,
      },
    ],
  });

  // 3) Also persist a second sent row on the smoke thread mirroring Storage metadata
  //    (so you can download the same valid PDF from Inbox without waiting for ingest).
  const uploadId = randomUUID();
  const storagePath = buildInboxAttachmentStoragePath({
    accountId,
    threadId: smokeThreadId,
    uploadId,
    filename,
  });

  const { error: up2 } = await supabase.storage
    .from(INBOX_ATTACHMENTS_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (up2) throw new Error(`Second storage upload failed: ${up2.message}`);

  const sentAt = new Date().toISOString();
  await supabase.from('inbox_attachment_uploads').insert({
    account_id: accountId,
    thread_id: smokeThreadId,
    storage_path: storagePath,
    filename,
    content_type: 'application/pdf',
    size: pdfBytes.length,
    status: 'sent',
    sent_at: sentAt,
  });

  const { data: liveMsg, error: liveErr } = await supabase
    .from('email_messages')
    .insert({
      thread_id: smokeThreadId,
      account_id: accountId,
      direction: 'sent',
      from_email: mailbox.email_address,
      from_name: mailbox.display_name,
      to_email: leadEmail,
      to_name: 'Porter',
      subject,
      body_text:
        'Live SMTP smoke: open this PDF. If it opens here, Inbox download of the same bytes should also open.',
      body_html:
        '<p>Live SMTP smoke: open this PDF. If it opens here, Inbox download of the same bytes should also open.</p>',
      message_id: messageId,
      received_at: sentAt,
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
  if (liveErr) throw new Error(`Live message insert failed: ${liveErr.message}`);

  await supabase
    .from('email_threads')
    .update({ last_message_at: sentAt, message_count: 3, subject })
    .eq('id', smokeThreadId);

  const out = {
    fixedInboxThread: `/inbox/${smokeThreadId}`,
    smtpMessageId: info.messageId || messageId,
    smtpAccepted: info.accepted,
    smtpRejected: info.rejected,
    liveSentMessageId: liveMsg?.id,
    filename,
    pdfBytes: pdfBytes.length,
    note: 'Prior download failed to open because the fixture was an 85-byte fake PDF. Storage path worked.',
  };
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/attachment-smoke-live-send.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await transporter.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
