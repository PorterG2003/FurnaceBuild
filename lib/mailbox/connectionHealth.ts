export interface TestMailboxConnectionParams {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  smtp?: { success: boolean; error?: string };
  imap?: { success: boolean; error?: string };
}

export interface MailboxConnectionFields {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
}

export interface MailboxConnectionHealthUpdate {
  status: 'connected' | 'error';
  smtp_status: 'active' | 'error';
  error_message: string | null;
}

export function mailboxToTestMailboxConnectionParams(
  mailbox: MailboxConnectionFields,
): TestMailboxConnectionParams {
  return {
    smtp_host: mailbox.smtp_host,
    smtp_port: mailbox.smtp_port,
    smtp_username: mailbox.smtp_username,
    smtp_password: mailbox.smtp_password,
    smtp_use_tls: mailbox.smtp_use_tls,
    smtp_use_ssl: mailbox.smtp_use_ssl,
    imap_host: mailbox.imap_host,
    imap_port: mailbox.imap_port,
    imap_username: mailbox.imap_username,
    imap_password: mailbox.imap_password,
    imap_use_ssl: mailbox.imap_use_ssl,
  };
}

export function buildMailboxConnectionHealthUpdate(
  result: TestConnectionResult,
): MailboxConnectionHealthUpdate {
  return {
    status: result.imap?.success === false ? 'error' : 'connected',
    smtp_status: result.smtp?.success === false ? 'error' : 'active',
    error_message: result.success ? null : result.message,
  };
}
