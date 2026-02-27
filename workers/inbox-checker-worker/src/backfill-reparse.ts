import { reportErrorToSlack } from '@furnace/slack-lib';
import { createClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

type CandidateRow = {
  id: string;
  thread_id: string;
  imap_uid: number | null;
  body_text: string | null;
  body_html: string | null;
  parse_version: number;
  email_threads: { mailbox_id: string } | { mailbox_id: string }[] | null;
};

type MailboxRow = {
  id: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
};

const ARTIFACT_PATTERN =
  /=([A-Fa-f0-9]{2})|=\s+[A-Za-z0-9<]|<=\s*\/|&am=\s*p;|CTO\s*&am=\s*p;/;

function hasLikelyArtifacts(bodyText: string | null, bodyHtml: string | null): boolean {
  const text = `${bodyText ?? ''}\n${bodyHtml ?? ''}`;
  return ARTIFACT_PATTERN.test(text);
}

function getMailboxId(row: CandidateRow): string | null {
  const t = row.email_threads;
  if (!t) return null;
  if (Array.isArray(t)) return t[0]?.mailbox_id ?? null;
  return t.mailbox_id ?? null;
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
  }

  const dryRun = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
  const limit = Number(process.env.BATCH_SIZE ?? 100);

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from('email_messages')
    .select(
      'id, thread_id, imap_uid, body_text, body_html, parse_version, email_threads!inner(mailbox_id)'
    )
    .eq('direction', 'received')
    .not('imap_uid', 'is', null)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as CandidateRow[];
  const candidates = rows.filter(
    (r) => (r.parse_version ?? 1) < 2 && hasLikelyArtifacts(r.body_text, r.body_html)
  );

  if (!candidates.length) {
    console.log('No candidate received messages found for backfill in this batch.');
    return;
  }

  console.log(`Found ${candidates.length} candidate message(s). Dry run: ${dryRun}`);

  const mailboxIds = Array.from(new Set(candidates.map(getMailboxId).filter(Boolean))) as string[];
  const { data: mailboxes, error: mailboxErr } = await supabase
    .from('mailboxes')
    .select('id, email_address, imap_host, imap_port, imap_username, imap_password, imap_use_ssl')
    .in('id', mailboxIds);

  if (mailboxErr) throw mailboxErr;

  const mailboxMap = new Map((mailboxes as MailboxRow[]).map((m) => [m.id, m]));
  let reparsed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of candidates) {
    const mailboxId = getMailboxId(row);
    const mailbox = mailboxId ? mailboxMap.get(mailboxId) : undefined;
    if (!mailbox || row.imap_uid == null) {
      skipped++;
      continue;
    }

    const client = new ImapFlow({
      host: mailbox.imap_host,
      port: mailbox.imap_port,
      secure: mailbox.imap_use_ssl,
      auth: {
        user: mailbox.imap_username,
        pass: mailbox.imap_password,
      },
      logger: false,
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');

      const downloaded = await client.download(row.imap_uid, undefined, { uid: true });
      const chunks: Buffer[] = [];
      for await (const chunk of downloaded.content) chunks.push(Buffer.from(chunk));
      const rawBuffer = Buffer.concat(chunks);
      const mail = await simpleParser(rawBuffer);

      const bodyText = typeof mail.text === 'string' ? mail.text.trim() : null;
      const bodyHtml = typeof mail.html === 'string' ? mail.html.trim() : null;

      if (dryRun) {
        reparsed++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from('email_messages')
        .update({
          body_text: bodyText || null,
          body_html: bodyHtml || null,
          parse_version: 2,
        })
        .eq('id', row.id);

      if (updateErr) {
        failed++;
      } else {
        reparsed++;
      }
    } catch (err) {
      console.error(`Failed to reparse message ${row.id}:`, err);
      failed++;
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        candidates: candidates.length,
        reparsed,
        skipped,
        failed,
      },
      null,
      2
    )
  );

  if (!dryRun && failed > 0) {
    reportErrorToSlack('Backfill reparse completed with failures', {
      severity: 'warning',
      candidates: String(candidates.length),
      reparsed: String(reparsed),
      failed: String(failed),
    });
  }
}

main().catch((err) => {
  console.error('Backfill reparse failed:', err);
  const msg = err instanceof Error ? err.message : String(err);
  reportErrorToSlack('Backfill reparse failed', { severity: 'critical', error: msg });
  process.exit(1);
});

