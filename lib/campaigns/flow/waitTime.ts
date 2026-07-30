export const UNIT_TO_SECONDS = {
  minutes: 60,
  hours: 3600,
  days: 86400,
} as const;

export type WaitDurationUnit = keyof typeof UNIT_TO_SECONDS;

/** Minimum allowed wait: 3 minutes. */
export const MIN_WAIT_DURATION_SECONDS = 3 * UNIT_TO_SECONDS.minutes;

/** Default wait when empty/missing/invalid: 3 days. */
export const DEFAULT_WAIT_DURATION_SECONDS = 3 * UNIT_TO_SECONDS.days;

export const DEFAULT_WAIT_DURATION = '3';
export const DEFAULT_WAIT_UNIT: WaitDurationUnit = 'days';

export function isWaitDurationUnit(value: unknown): value is WaitDurationUnit {
  return value === 'minutes' || value === 'hours' || value === 'days';
}

export function inferDurationUnit(waitDurationSeconds: number): WaitDurationUnit {
  if (waitDurationSeconds % UNIT_TO_SECONDS.days === 0) return 'days';
  if (waitDurationSeconds % UNIT_TO_SECONDS.hours === 0) return 'hours';
  return 'minutes';
}

export function inferDurationValue(
  waitDurationSeconds: number,
  unit: WaitDurationUnit,
): string {
  return String(Math.max(1, Math.floor(waitDurationSeconds / UNIT_TO_SECONDS[unit])));
}

/**
 * Resolve canonical wait seconds from node fields.
 * - Empty / missing / non-positive → default (3 days)
 * - Positive but under minimum → clamp to 3 minutes
 * - Otherwise keep floored integer seconds
 */
export function resolveWaitDurationSeconds(input: {
  wait_duration_seconds?: unknown;
  duration?: unknown;
  unit?: unknown;
}): number {
  const unit = isWaitDurationUnit(input.unit) ? input.unit : 'hours';
  const duration =
    typeof input.duration === 'string'
      ? input.duration
      : typeof input.duration === 'number' && Number.isFinite(input.duration)
        ? String(input.duration)
        : '';

  const explicitSeconds =
    typeof input.wait_duration_seconds === 'number' && Number.isFinite(input.wait_duration_seconds)
      ? Math.floor(input.wait_duration_seconds)
      : 0;

  const computedSeconds =
    duration.trim().length > 0
      ? Math.floor(Number.parseInt(duration.trim(), 10) || 0) * UNIT_TO_SECONDS[unit]
      : 0;

  let waitDurationSeconds = explicitSeconds > 0 ? explicitSeconds : computedSeconds;

  if (waitDurationSeconds <= 0) {
    return DEFAULT_WAIT_DURATION_SECONDS;
  }
  if (waitDurationSeconds < MIN_WAIT_DURATION_SECONDS) {
    return MIN_WAIT_DURATION_SECONDS;
  }
  return waitDurationSeconds;
}
