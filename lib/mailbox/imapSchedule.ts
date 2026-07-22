export const IMAP_CHECK_INTERVAL_MINUTES = 5;
export const IMAP_TRANSIENT_BACKOFF_MINUTES = [1, 5, 15, 60] as const;
export const IMAP_TRANSIENT_PROMOTE_AFTER = 5;

export function transientBackoffMinutes(streak: number): number {
  const index = Math.max(0, Math.min(streak - 1, IMAP_TRANSIENT_BACKOFF_MINUTES.length - 1));
  return IMAP_TRANSIENT_BACKOFF_MINUTES[index] ?? IMAP_TRANSIENT_BACKOFF_MINUTES[IMAP_TRANSIENT_BACKOFF_MINUTES.length - 1];
}

export function addMinutes(isoNow: string, minutes: number): string {
  const ms = new Date(isoNow).getTime() + minutes * 60_000;
  return new Date(ms).toISOString();
}

export interface MailboxImapScheduleSuccessUpdate {
  last_synced_at: string;
  imap_claimed_at: null;
  imap_last_attempt_at: string;
  imap_next_check_at: string;
  imap_consecutive_failures: 0;
  imap_last_error_code: null;
  error_message: null;
}

export interface MailboxImapScheduleFailureUpdate {
  imap_claimed_at: null;
  imap_last_attempt_at: string;
  imap_next_check_at: string | null;
  imap_consecutive_failures: number;
  imap_last_error_code: string | null;
  error_message: string;
  status?: 'error';
}

export interface MailboxImapRestoreUpdate {
  status: 'connected';
  error_message: null;
  imap_claimed_at: null;
  imap_consecutive_failures: 0;
  imap_last_error_code: null;
  imap_next_check_at: string;
  imap_last_recovery_at: string;
}

export function buildMailboxImapSuccessUpdate(
  now: string = new Date().toISOString(),
  checkIntervalMinutes: number = IMAP_CHECK_INTERVAL_MINUTES,
): MailboxImapScheduleSuccessUpdate {
  return {
    last_synced_at: now,
    imap_claimed_at: null,
    imap_last_attempt_at: now,
    imap_next_check_at: addMinutes(now, checkIntervalMinutes),
    imap_consecutive_failures: 0,
    imap_last_error_code: null,
    error_message: null,
  };
}

export function buildMailboxImapFailureUpdate(options: {
  kind: 'permanent' | 'transient' | 'unknown';
  message: string;
  consecutiveFailures?: number;
  errorCode?: string | null;
  now?: string;
  promoteAfter?: number;
}): MailboxImapScheduleFailureUpdate {
  const now = options.now ?? new Date().toISOString();
  const streak = (options.consecutiveFailures ?? 0) + 1;
  const promoteAfter = options.promoteAfter ?? IMAP_TRANSIENT_PROMOTE_AFTER;
  const errorCode = options.errorCode ?? null;

  if (options.kind === 'permanent') {
    return {
      status: 'error',
      error_message: options.message,
      imap_claimed_at: null,
      imap_last_attempt_at: now,
      imap_next_check_at: null,
      imap_consecutive_failures: streak,
      imap_last_error_code: errorCode,
    };
  }

  // transient and unknown: stay hot with backoff, promote after sustained failures
  if (streak >= promoteAfter) {
    return {
      status: 'error',
      error_message: options.message,
      imap_claimed_at: null,
      imap_last_attempt_at: now,
      imap_next_check_at: null,
      imap_consecutive_failures: streak,
      imap_last_error_code: errorCode,
    };
  }

  return {
    error_message: options.message,
    imap_claimed_at: null,
    imap_last_attempt_at: now,
    imap_next_check_at: addMinutes(now, transientBackoffMinutes(streak)),
    imap_consecutive_failures: streak,
    imap_last_error_code: errorCode,
  };
}

export function buildMailboxImapRestoreUpdate(
  now: string = new Date().toISOString(),
): MailboxImapRestoreUpdate {
  return {
    status: 'connected',
    error_message: null,
    imap_claimed_at: null,
    imap_consecutive_failures: 0,
    imap_last_error_code: null,
    imap_next_check_at: now,
    imap_last_recovery_at: now,
  };
}
