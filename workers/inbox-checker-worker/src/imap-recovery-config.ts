export const IMAP_RECOVERY_DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const IMAP_RECOVERY_MIN_INTERVAL_MS = 60_000;
export const IMAP_RECOVERY_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const IMAP_RECOVERY_BATCH_SIZE = 100;
export const IMAP_RECOVERY_COOLDOWN_HOURS = 24;
export const IMAP_RECOVERY_CONCURRENCY = 2;
export const IMAP_RECOVERY_RUN_ON_START = true;

export function resolveImapRecoveryIntervalMs(envValue: string | undefined): number {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) {
    return IMAP_RECOVERY_DEFAULT_INTERVAL_MS;
  }

  return Math.min(
    Math.max(Math.floor(parsed), IMAP_RECOVERY_MIN_INTERVAL_MS),
    IMAP_RECOVERY_MAX_INTERVAL_MS,
  );
}
