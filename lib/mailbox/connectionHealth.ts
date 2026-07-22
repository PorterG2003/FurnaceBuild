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
  imap_consecutive_failures?: number;
  imap_last_error_code?: string | null;
  imap_next_check_at?: string;
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
  now: string = new Date().toISOString(),
): MailboxConnectionHealthUpdate {
  const status = result.imap?.success === false ? 'error' : 'connected';
  const smtp_status = result.smtp?.success === false ? 'error' : 'active';
  const error_message = result.success ? null : result.message;

  if (result.imap?.success === false) {
    return {
      status,
      smtp_status,
      error_message,
    };
  }

  // IMAP healthy (or not tested as failed): re-enter hot path immediately.
  return {
    status,
    smtp_status,
    error_message,
    imap_consecutive_failures: 0,
    imap_last_error_code: null,
    imap_next_check_at: now,
  };
}
