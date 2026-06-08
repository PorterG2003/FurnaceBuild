export type Provider = 'gmail' | 'outlook' | 'custom';

export interface MailboxFormData {
  provider: Provider;
  email_address: string;
  display_name: string;
  signature: string;
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  imap_host: string;
  imap_port: string;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
  /** Minimum seconds between sends (throttle). Default 180. */
  min_gap_seconds?: number | null;
  /** Max sends per day. Default 50. */
  daily_limit?: number | null;
  /** Max sends per hour. Default 10. */
  hourly_limit?: number | null;
}

export const PROVIDER_PRESETS: Record<Provider, Partial<MailboxFormData>> = {
  gmail: {
    smtp_host: 'smtp.gmail.com',
    smtp_port: '587',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.gmail.com',
    imap_port: '993',
    imap_use_ssl: true,
  },
  outlook: {
    smtp_host: 'smtp-mail.outlook.com',
    smtp_port: '587',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'outlook.office365.com',
    imap_port: '993',
    imap_use_ssl: true,
  },
  custom: {},
};

export const DEFAULT_MAILBOX_FORM_DATA: MailboxFormData = {
  provider: 'gmail',
  email_address: '',
  display_name: '',
  signature: '',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '587',
  smtp_username: '',
  smtp_password: '',
  smtp_use_tls: true,
  smtp_use_ssl: false,
  imap_host: 'imap.gmail.com',
  imap_port: '993',
  imap_username: '',
  imap_password: '',
  imap_use_ssl: true,
};

/** Blank form for create-mailbox flow: no provider prefills; all SMTP/IMAP fields empty. */
export const CREATE_MAILBOX_FORM_DATA: MailboxFormData = {
  provider: 'custom',
  email_address: '',
  display_name: '',
  signature: '',
  smtp_host: '',
  smtp_port: '',
  smtp_username: '',
  smtp_password: '',
  smtp_use_tls: true,
  smtp_use_ssl: false,
  imap_host: '',
  imap_port: '',
  imap_username: '',
  imap_password: '',
  imap_use_ssl: true,
};

/** Blank form for bulk update: empty strings so only filled fields are applied to selected mailboxes. */
export const BLANK_MAILBOX_FORM_DATA: MailboxFormData = {
  provider: 'gmail',
  email_address: '',
  display_name: '',
  signature: '',
  smtp_host: '',
  smtp_port: '',
  smtp_username: '',
  smtp_password: '',
  smtp_use_tls: true,
  smtp_use_ssl: false,
  imap_host: '',
  imap_port: '',
  imap_username: '',
  imap_password: '',
  imap_use_ssl: true,
};

export interface TestConnectionResult {
  success: boolean;
  message: string;
  smtp?: { success: boolean; error?: string };
  imap?: { success: boolean; error?: string };
}

export type BulkMailboxTagMode = 'patch' | 'replace';

export interface BulkMailboxTagChanges {
  mode: BulkMailboxTagMode;
  addTagIds: string[];
  removeTagIds: string[];
  replaceTagIds: string[];
}

export const EMPTY_BULK_MAILBOX_TAG_CHANGES: BulkMailboxTagChanges = {
  mode: 'patch',
  addTagIds: [],
  removeTagIds: [],
  replaceTagIds: [],
};

export function hasBulkMailboxTagChanges(changes: BulkMailboxTagChanges): boolean {
  if (changes.mode === 'replace') return changes.replaceTagIds.length > 0;
  const { addTagIds, removeTagIds } = normalizeBulkMailboxPatchTags(changes);
  return addTagIds.length > 0 || removeTagIds.length > 0;
}

/** Returns tag ids present in both add and remove lists (patch mode only). */
export function getBulkMailboxTagConflicts(changes: BulkMailboxTagChanges): string[] {
  if (changes.mode === 'replace') return [];
  const removeSet = new Set(changes.removeTagIds);
  return changes.addTagIds.filter((id) => removeSet.has(id));
}

/** Ensures a tag cannot appear in both add and remove lists; add wins when normalizing. */
export function normalizeBulkMailboxPatchTags(changes: BulkMailboxTagChanges): {
  addTagIds: string[];
  removeTagIds: string[];
} {
  const addSet = new Set(changes.addTagIds);
  return {
    addTagIds: changes.addTagIds,
    removeTagIds: changes.removeTagIds.filter((id) => !addSet.has(id)),
  };
}

export function withBulkMailboxAddTagIds(
  changes: BulkMailboxTagChanges,
  addTagIds: string[],
): BulkMailboxTagChanges {
  const addSet = new Set(addTagIds);
  return {
    ...changes,
    addTagIds,
    removeTagIds: changes.removeTagIds.filter((id) => !addSet.has(id)),
  };
}

export function withBulkMailboxRemoveTagIds(
  changes: BulkMailboxTagChanges,
  removeTagIds: string[],
): BulkMailboxTagChanges {
  const removeSet = new Set(removeTagIds);
  return {
    ...changes,
    removeTagIds,
    addTagIds: changes.addTagIds.filter((id) => !removeSet.has(id)),
  };
}
