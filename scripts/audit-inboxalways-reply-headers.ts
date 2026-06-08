import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { openImapInbox } from '@furnace/mailbox-lib';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import Papa from 'papaparse';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type HeaderClass =
  | 'in_reply_to'
  | 'references_only'
  | 'headerless_reply_like'
  | 'headerless_other'
  | 'not_reply_like';

type MailboxRow = {
  id?: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
};

type MessageSample = {
  mailboxEmail: string;
  imapHost: string;
  uid: number;
  subject: string;
  from: string;
  date: string | null;
  classification: HeaderClass;
  inReplyTo: string | null;
  referencesPreview: string | null;
};

type Args = {
  mailboxLimit: number;
  messagesPerMailbox: number;
  days: number;
  imapHost: string | null;
  accountId: string | null;
  csvPath: string | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  let mailboxLimit = Number(process.env.MAILBOX_LIMIT ?? '20');
  let messagesPerMailbox = Number(process.env.MESSAGES_PER_MAILBOX ?? '25');
  let days = Number(process.env.AUDIT_DAYS ?? '60');
  let imapHost = process.env.IMAP_HOST?.trim() || null;
  let accountId = process.env.ACCOUNT_ID?.trim() || null;
  let csvPath = process.env.MAILBOX_CSV?.trim() || null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mailbox-limit' && argv[i + 1]) {
      mailboxLimit = Number(argv[++i]);
    } else if (arg === '--messages' && argv[i + 1]) {
      messagesPerMailbox = Number(argv[++i]);
    } else if (arg === '--days' && argv[i + 1]) {
      days = Number(argv[++i]);
    } else if (arg === '--imap-host' && argv[i + 1]) {
      imapHost = argv[++i]!.trim();
    } else if (arg === '--account-id' && argv[i + 1]) {
      accountId = argv[++i]!.trim();
    } else if (arg === '--csv' && argv[i + 1]) {
      csvPath = argv[++i]!.trim();
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { mailboxLimit, messagesPerMailbox, days, imapHost, accountId, csvPath, dryRun };
}

function getCsvCell(row: Record<string, string>, key: string): string {
  const lower = key.toLowerCase();
  const found = Object.keys(row).find((candidate) => candidate.toLowerCase() === lower);
  return found != null ? (row[found] ?? '').trim() : '';
}

function parseMailboxCsv(csvPath: string): Record<string, string>[] {
  const raw = readFileSync(csvPath, 'utf8').trim();
  if (!raw.length) return [];

  const withoutBom = raw.startsWith('\ufeff') ? raw.slice(1) : raw;
  const firstLine = withoutBom.split(/\r?\n/)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const result = Papa.parse<Record<string, string>>(withoutBom, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    delimiter,
  });

  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new Error(first?.message ? `Invalid CSV: ${first.message}` : 'Invalid CSV');
  }

  return result.data;
}

function csvRowToMailbox(row: Record<string, string>): MailboxRow | null {
  const email = getCsvCell(row, 'from_email');
  const password = getCsvCell(row, 'password');
  const imapHost = getCsvCell(row, 'imap_host');
  const imapPort = parseInt(getCsvCell(row, 'imap_port'), 10);
  const userName = getCsvCell(row, 'user_name');
  const imapUserName = getCsvCell(row, 'imap_user_name') || userName;
  const imapPassword = getCsvCell(row, 'imap_password') || password;

  if (!email || !imapHost || !imapUserName || !imapPassword || !Number.isFinite(imapPort)) {
    return null;
  }

  return {
    email_address: email,
    imap_host: imapHost,
    imap_port: imapPort,
    imap_username: imapUserName,
    imap_password: imapPassword,
    imap_use_ssl: true,
  };
}

function loadMailboxesFromCsv(csvPath: string, args: Args): MailboxRow[] {
  const rows = parseMailboxCsv(csvPath);
  const mailboxes = rows
    .map(csvRowToMailbox)
    .filter((mailbox): mailbox is MailboxRow => mailbox != null)
    .filter((mailbox) => (args.imapHost ? mailbox.imap_host === args.imapHost : true));

  return mailboxes.slice(0, args.mailboxLimit);
}

function looksLikeReplySubject(subject: string): boolean {
  const normalized = subject.trim().toLowerCase();
  return (
    normalized.startsWith('re:') ||
    normalized.startsWith('re ') ||
    normalized.startsWith('fwd:') ||
    normalized.startsWith('fw:')
  );
}

function classifyMessage(input: {
  subject: string;
  inReplyTo: string | null;
  references: string | null;
}): HeaderClass {
  const hasInReplyTo = !!input.inReplyTo?.trim();
  const hasReferences = !!input.references?.trim();

  if (hasInReplyTo) return 'in_reply_to';
  if (hasReferences) return 'references_only';
  if (looksLikeReplySubject(input.subject)) return 'headerless_reply_like';
  return 'headerless_other';
}

async function resolveSupabaseClient() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
  }

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Provide URL plus SSM prefix or SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return {
    targetEnv,
    urlSource,
    secretSource: secretParamPath ? `Parameter Store ${secretParamPath}` : 'environment variable',
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function fetchMailboxes(
  supabase: ReturnType<typeof createClient>,
  args: Args,
): Promise<MailboxRow[]> {
  let query = supabase
    .from('mailboxes')
    .select(
      'id,email_address,imap_host,imap_port,imap_username,imap_password,imap_use_ssl',
    )
    .is('deleted_at', null)
    .neq('imap_host', 'imap.gmail.com')
    .order('email_address', { ascending: true })
    .limit(args.mailboxLimit);

  if (args.imapHost) {
    query = query.eq('imap_host', args.imapHost);
  }
  if (args.accountId) {
    query = query.eq('account_id', args.accountId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load mailboxes: ${error.message}`);
  }

  return (data ?? []) as MailboxRow[];
}

async function auditMailbox(
  mailbox: MailboxRow,
  args: Args,
): Promise<{ samples: MessageSample[]; errors: string[]; scanned: number }> {
  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_use_ssl,
    auth: {
      user: mailbox.imap_username,
      pass: mailbox.imap_password,
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const samples: MessageSample[] = [];
  const errors: string[] = [];
  let scanned = 0;

  try {
    await client.connect();
    await openImapInbox(client);

    const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
    const uids = await client.search({ since }, { uid: true });
    const uidList = Array.isArray(uids) ? uids : [];
    const recentUids = uidList.slice(-args.messagesPerMailbox);

    for (const uid of recentUids) {
      try {
        const fetched = await client.fetchOne(
          uid,
          { source: true, uid: true },
          { uid: true },
        );
        if (!fetched?.source) continue;

        const mail = await simpleParser(fetched.source as Buffer);
        const refs = mail.references;
        const referencesRaw =
          refs == null
            ? null
            : Array.isArray(refs)
              ? refs.filter(Boolean).join(' ')
              : String(refs);

        const fromAddress = mail.from?.value?.[0]?.address ?? '';
        const classification = classifyMessage({
          subject: mail.subject ?? '',
          inReplyTo: mail.inReplyTo ?? null,
          references: referencesRaw,
        });

        scanned += 1;
        samples.push({
          mailboxEmail: mailbox.email_address,
          imapHost: mailbox.imap_host,
          uid,
          subject: (mail.subject ?? '').slice(0, 120),
          from: fromAddress,
          date: mail.date?.toISOString() ?? null,
          classification,
          inReplyTo: mail.inReplyTo ?? null,
          referencesPreview: referencesRaw ? referencesRaw.slice(0, 160) : null,
        });
      } catch (error) {
        errors.push(
          `uid ${uid}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }

  return { samples, errors, scanned };
}

function summarize(samples: MessageSample[]) {
  const counts: Record<HeaderClass, number> = {
    in_reply_to: 0,
    references_only: 0,
    headerless_reply_like: 0,
    headerless_other: 0,
    not_reply_like: 0,
  };

  for (const sample of samples) {
    counts[sample.classification] += 1;
  }

  const replyLike = samples.filter(
    (sample) =>
      sample.classification === 'in_reply_to' ||
      sample.classification === 'references_only' ||
      sample.classification === 'headerless_reply_like',
  );

  const replyLikeTotal = replyLike.length;
  const wouldMiss = replyLike.filter(
    (sample) =>
      sample.classification === 'references_only' ||
      sample.classification === 'headerless_reply_like',
  );

  return {
    counts,
    replyLikeTotal,
    wouldMissCount: wouldMiss.length,
    wouldMiss,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let mailboxes: MailboxRow[];
  let sourceLabel: string;

  if (args.csvPath) {
    mailboxes = loadMailboxesFromCsv(args.csvPath, args);
    sourceLabel = `CSV ${args.csvPath}`;
    console.log(`Mailbox source: ${sourceLabel}`);
  } else {
    const { targetEnv, urlSource, secretSource, supabase } = await resolveSupabaseClient();
    mailboxes = await fetchMailboxes(supabase, args);
    sourceLabel = `Supabase ${targetEnv}`;
    console.log(`Target env: ${targetEnv}`);
    console.log(`Supabase URL from ${urlSource}`);
    console.log(`Supabase secret from ${secretSource}`);
    if (!args.accountId) {
      console.warn(
        'Warning: no --account-id filter. This scans all non-Gmail mailboxes in the project, not just your migration set.',
      );
    }
  }

  console.log(
    `Auditing up to ${mailboxes.length} mailbox(es), ${args.messagesPerMailbox} recent message(s) each, since ${args.days} day(s)`,
  );

  if (args.dryRun) {
    console.log('Dry run only. Mailboxes:');
    for (const mailbox of mailboxes) {
      console.log(`- ${mailbox.email_address} (${mailbox.imap_host})`);
    }
    return;
  }

  const allSamples: MessageSample[] = [];
  const mailboxResults: Array<{
    email: string;
    imapHost: string;
    scanned: number;
    errors: string[];
  }> = [];

  for (const mailbox of mailboxes) {
    process.stdout.write(`Scanning ${mailbox.email_address}... `);
    const result = await auditMailbox(mailbox, args);
    allSamples.push(...result.samples);
    mailboxResults.push({
      email: mailbox.email_address,
      imapHost: mailbox.imap_host,
      scanned: result.scanned,
      errors: result.errors,
    });
    console.log(`${result.scanned} message(s)${result.errors.length ? `, ${result.errors.length} error(s)` : ''}`);
  }

  const summary = summarize(allSamples);
  const connectionFailures = mailboxResults.filter((row) => row.errors.length > 0 && row.scanned === 0);

  console.log('\n=== Header audit summary ===');
  console.log(`Mailboxes scanned: ${mailboxResults.length}`);
  console.log(`Connection failures: ${connectionFailures.length}`);
  console.log(`Messages scanned: ${allSamples.length}`);
  console.log(`Reply-like messages: ${summary.replyLikeTotal}`);
  console.log(`Would be missed by current isReply() gate: ${summary.wouldMissCount}`);
  console.log('Classification counts:');
  for (const [key, value] of Object.entries(summary.counts)) {
    console.log(`- ${key}: ${value}`);
  }

  if (summary.wouldMiss.length > 0) {
    console.log('\nMissed-by-isReply samples:');
    for (const sample of summary.wouldMiss.slice(0, 10)) {
      console.log(
        JSON.stringify({
          mailboxEmail: sample.mailboxEmail,
          uid: sample.uid,
          subject: sample.subject,
          classification: sample.classification,
          inReplyTo: sample.inReplyTo,
          referencesPreview: sample.referencesPreview,
        }),
      );
    }
  }

  if (connectionFailures.length > 0) {
    console.log('\nConnection failures:');
    for (const row of connectionFailures.slice(0, 10)) {
      console.log(`- ${row.email}: ${row.errors.join('; ')}`);
    }
  }

  console.log(
    '\nInterpretation:',
    summary.wouldMissCount === 0
      ? 'No reply-like messages lacked In-Reply-To in this sample.'
      : 'Some reply-like messages lack In-Reply-To; Furnace would skip them before handleReply().',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
