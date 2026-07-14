#!/usr/bin/env npx tsx
/**
 * Backfill Storage paths onto sent email_messages.attachments from message_jobs base64.
 *
 * Usage:
 *   npx tsx scripts/backfill-sent-attachment-storage.ts --dry-run
 *   npx tsx scripts/backfill-sent-attachment-storage.ts --limit 20
 *   npx tsx scripts/backfill-sent-attachment-storage.ts --thread-id <uuid>
 *
 * Do NOT run against production historical threads until new-send path is verified on dev.
 */

import { createClient } from '@supabase/supabase-js';
import { buildInboxAttachmentStoragePath } from '../lib/inbox/attachmentStoragePath';
import { INBOX_ATTACHMENTS_BUCKET } from '../lib/inbox/attachmentStoragePath';
import {
  patchMessageAttachmentsWithStoragePaths,
  stripJobAttachmentContent,
  type JobAttachment,
  type MessageAttachment,
} from './backfill-sent-attachment-storage-helpers';

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const limit = Number(argValue('--limit') ?? '50');
  const threadId = argValue('--thread-id');

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let query = supabase
    .from('email_messages')
    .select('id, thread_id, account_id, message_job_id, attachments, direction')
    .eq('direction', 'sent')
    .not('attachments', 'eq', '[]')
    .not('message_job_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Number.isFinite(limit) ? limit : 50);

  if (threadId) {
    query = query.eq('thread_id', threadId);
  }

  const { data: messages, error } = await query;
  if (error) throw error;

  let scanned = 0;
  let uploaded = 0;
  let patched = 0;
  let skipped = 0;

  for (const msg of messages ?? []) {
    scanned += 1;
    const attachments = (msg.attachments ?? []) as MessageAttachment[];
    if (!Array.isArray(attachments) || attachments.length === 0) {
      skipped += 1;
      continue;
    }
    if (attachments.every((a) => !!a.storagePath)) {
      skipped += 1;
      continue;
    }
    if (!msg.message_job_id) {
      skipped += 1;
      continue;
    }

    const { data: job, error: jobError } = await supabase
      .from('message_jobs')
      .select('id, message_data')
      .eq('id', msg.message_job_id)
      .maybeSingle();
    if (jobError || !job) {
      console.warn(`Skip ${msg.id}: job not found`);
      skipped += 1;
      continue;
    }

    const md = (job.message_data ?? {}) as { attachments?: JobAttachment[] };
    const jobAttachments = Array.isArray(md.attachments) ? md.attachments : [];

    const pathForFilename = (filename: string, index: number) => {
      if (!msg.account_id || !msg.thread_id) return null;
      return buildInboxAttachmentStoragePath({
        accountId: msg.account_id,
        threadId: msg.thread_id,
        uploadId: msg.id,
        filename: `${index}-${filename}`,
      });
    };

    const { next, changed } = patchMessageAttachmentsWithStoragePaths(
      attachments,
      jobAttachments,
      pathForFilename
    );
    if (!changed) {
      skipped += 1;
      continue;
    }

    console.log(`${dryRun ? '[dry-run] ' : ''}message ${msg.id}: would patch ${next.filter((a) => a.storagePath).length} attachment(s)`);

    if (dryRun) continue;

    for (let i = 0; i < next.length; i++) {
      const att = next[i];
      const prev = attachments[i];
      if (!att.storagePath || prev?.storagePath) continue;
      const jobAtt = jobAttachments.find(
        (j) => (j.filename ?? '').toLowerCase() === (att.filename ?? '').toLowerCase()
      );
      if (!jobAtt?.content) continue;
      const bytes = Buffer.from(jobAtt.content, 'base64');
      const { error: upErr } = await supabase.storage
        .from(INBOX_ATTACHMENTS_BUCKET)
        .upload(att.storagePath, bytes, {
          contentType: att.contentType ?? 'application/octet-stream',
          upsert: true,
        });
      if (upErr) {
        console.error(`Upload failed for ${att.storagePath}:`, upErr.message);
        continue;
      }
      uploaded += 1;

      await supabase.from('inbox_attachment_uploads').upsert(
        {
          account_id: msg.account_id,
          thread_id: msg.thread_id,
          storage_path: att.storagePath,
          filename: att.filename ?? 'attachment',
          content_type: att.contentType ?? 'application/octet-stream',
          size: att.size ?? bytes.length,
          status: 'sent',
          sent_at: new Date().toISOString(),
        },
        { onConflict: 'storage_path' }
      );
    }

    const { error: patchErr } = await supabase
      .from('email_messages')
      .update({ attachments: next })
      .eq('id', msg.id);
    if (patchErr) {
      console.error(`Patch message failed ${msg.id}:`, patchErr.message);
      continue;
    }
    patched += 1;

    const stripped = {
      ...(job.message_data as object),
      attachments: stripJobAttachmentContent(jobAttachments),
    };
    await supabase.from('message_jobs').update({ message_data: stripped }).eq('id', job.id);
  }

  console.log(
    JSON.stringify({ dryRun, scanned, uploaded, patched, skipped, threadId: threadId ?? null }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
