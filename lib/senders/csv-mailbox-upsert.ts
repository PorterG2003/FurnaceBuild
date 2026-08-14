import type { MailboxInsert, MailboxUpdate } from '@/lib/supabase/types';

export type MailboxCsvRow = Record<string, string>;

export type ExistingMailboxForUpsert = {
  id: string;
  email_address: string;
  created_at: string;
  deleted_at?: string | null;
};

export type PartitionedMailboxCsvRows = {
  toCreate: MailboxCsvRow[];
  toUpdate: { row: MailboxCsvRow; mailboxId: string }[];
};

export function getCsvCell(row: MailboxCsvRow, key: string): string {
  const lower = key.toLowerCase();
  const found = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return found != null ? (row[found] ?? '').trim() : '';
}

export function normalizeMailboxEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Active mailboxes only; if several share an email, keep the oldest by created_at. */
export function buildExistingMailboxEmailIndex(
  existing: ExistingMailboxForUpsert[]
): Map<string, string> {
  const oldestByEmail = new Map<string, ExistingMailboxForUpsert>();
  for (const mailbox of existing) {
    if (mailbox.deleted_at) continue;
    const email = normalizeMailboxEmail(mailbox.email_address);
    if (!email) continue;
    const current = oldestByEmail.get(email);
    if (!current || mailbox.created_at < current.created_at) {
      oldestByEmail.set(email, mailbox);
    }
  }
  const index = new Map<string, string>();
  for (const [email, mailbox] of oldestByEmail) {
    index.set(email, mailbox.id);
  }
  return index;
}

export function partitionMailboxCsvRows(
  validRows: MailboxCsvRow[],
  existing: ExistingMailboxForUpsert[]
): PartitionedMailboxCsvRows {
  const index = buildExistingMailboxEmailIndex(existing);
  const toCreate: MailboxCsvRow[] = [];
  const toUpdate: { row: MailboxCsvRow; mailboxId: string }[] = [];
  for (const row of validRows) {
    const email = normalizeMailboxEmail(getCsvCell(row, 'from_email'));
    const mailboxId = email ? index.get(email) : undefined;
    if (mailboxId) toUpdate.push({ row, mailboxId });
    else toCreate.push(row);
  }
  return { toCreate, toUpdate };
}

export function rowToMailboxInsert(
  row: MailboxCsvRow,
  accountId: string,
  userId: string
): MailboxInsert {
  const password = getCsvCell(row, 'password');
  const imapPassword = getCsvCell(row, 'imap_password');
  const userName = getCsvCell(row, 'user_name');
  const imapUserName = getCsvCell(row, 'imap_user_name');
  const maxPerDay = getCsvCell(row, 'max_email_per_day');
  return {
    account_id: accountId,
    user_id: userId,
    email_address: getCsvCell(row, 'from_email'),
    display_name: getCsvCell(row, 'from_name') || null,
    signature: getCsvCell(row, 'signature') || null,
    provider: 'custom',
    smtp_host: getCsvCell(row, 'smtp_host'),
    smtp_port: parseInt(getCsvCell(row, 'smtp_port'), 10) || 587,
    smtp_username: userName,
    smtp_password: password,
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: getCsvCell(row, 'imap_host'),
    imap_port: parseInt(getCsvCell(row, 'imap_port'), 10) || 993,
    imap_username: imapUserName || userName,
    imap_password: imapPassword || password,
    imap_use_ssl: true,
    status: 'connected',
    min_gap_seconds: null,
    daily_limit: maxPerDay ? parseInt(maxPerDay, 10) : null,
    hourly_limit: null,
  };
}

function parseOptionalInt(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Sparse patch: omit blank CSV cells. No status, TLS, or IMAP-fallback writes. */
export function rowToMailboxUpdate(row: MailboxCsvRow): MailboxUpdate {
  const patch: MailboxUpdate = {};
  const displayName = getCsvCell(row, 'from_name');
  if (displayName) patch.display_name = displayName;
  const signature = getCsvCell(row, 'signature');
  if (signature) patch.signature = signature;
  const dailyLimit = parseOptionalInt(getCsvCell(row, 'max_email_per_day'));
  if (dailyLimit != null) patch.daily_limit = dailyLimit;
  const smtpHost = getCsvCell(row, 'smtp_host');
  if (smtpHost) patch.smtp_host = smtpHost;
  const smtpPort = parseOptionalInt(getCsvCell(row, 'smtp_port'));
  if (smtpPort != null) patch.smtp_port = smtpPort;
  const smtpUsername = getCsvCell(row, 'user_name');
  if (smtpUsername) patch.smtp_username = smtpUsername;
  const smtpPassword = getCsvCell(row, 'password');
  if (smtpPassword) patch.smtp_password = smtpPassword;
  const imapHost = getCsvCell(row, 'imap_host');
  if (imapHost) patch.imap_host = imapHost;
  const imapPort = parseOptionalInt(getCsvCell(row, 'imap_port'));
  if (imapPort != null) patch.imap_port = imapPort;
  const imapUsername = getCsvCell(row, 'imap_user_name');
  if (imapUsername) patch.imap_username = imapUsername;
  const imapPassword = getCsvCell(row, 'imap_password');
  if (imapPassword) patch.imap_password = imapPassword;
  return patch;
}
