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
