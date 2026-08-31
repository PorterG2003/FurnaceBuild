import { format, utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import type { CampaignStatus } from './flow/types';

export const DEFAULT_SCHEDULE_TIMEZONE = 'America/Chicago';
export const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type LifecycleScheduleInput = {
  time_zone: string;
  start_on: string | null;
  pause_on: string | null;
};

export type LifecycleScheduleView = LifecycleScheduleInput & {
  start_at: string | null;
  pause_at: string | null;
};

export type LifecycleScheduleRow = {
  schedule_timezone?: string | null;
  start_date?: string | null;
  pause_date?: string | null;
  start_at?: string | null;
  pause_at?: string | null;
};

export type LifecycleValidationError = {
  code: string;
  message: string;
  param: string;
};

export const LIFECYCLE_INTERNAL_COLUMNS = [
  'start_date',
  'pause_date',
  'start_at',
  'pause_at',
  'schedule_timezone',
] as const;

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function parseYmd(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const match = trimmed.match(YMD_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function localYmd(now: Date, timeZone: string): string {
  return format(utcToZonedTime(now, timeZone), 'yyyy-MM-dd');
}

/** Shift a validated `YYYY-MM-DD` by whole calendar days. Returns null if `ymd` is invalid. */
export function addYmdDays(ymd: string, days: number): string | null {
  const parsed = parseYmd(ymd);
  if (!parsed) return null;
  const [year, month, day] = parsed.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return parseYmd(
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`,
  );
}

/** First calendar day after today in `timeZone` — used to disable today and earlier in pickers. */
export function earliestSelectableYmd(now: Date, timeZone: string): string {
  const tomorrow = addYmdDays(localYmd(now, timeZone), 1);
  if (!tomorrow) {
    throw new Error(`Failed to compute earliest selectable date for timezone ${timeZone}`);
  }
  return tomorrow;
}

export function localMidnightUtcIso(ymd: string, timeZone: string): string {
  return zonedTimeToUtc(`${ymd} 00:00:00`, timeZone).toISOString();
}

export function decideLaunchStatus(
  startOn: string | null,
  timeZone: string,
  now: Date = new Date(),
): 'running' | 'scheduled' {
  if (!startOn) return 'running';
  return startOn <= localYmd(now, timeZone) ? 'running' : 'scheduled';
}

export function isCampaignSendEligible(params: {
  status?: string | null;
  deletedAt?: string | null;
  startAt?: string | null;
  pauseAt?: string | null;
  now?: Date;
}): boolean {
  if (params.deletedAt) return false;
  if (params.status !== 'running') return false;
  const nowMs = (params.now ?? new Date()).getTime();
  if (params.startAt) {
    const startMs = Date.parse(params.startAt);
    if (!Number.isNaN(startMs) && startMs > nowMs) return false;
  }
  if (params.pauseAt) {
    const pauseMs = Date.parse(params.pauseAt);
    if (!Number.isNaN(pauseMs) && nowMs >= pauseMs) return false;
  }
  return true;
}

export function buildLifecycleScheduleView(input: LifecycleScheduleInput): LifecycleScheduleView {
  return {
    time_zone: input.time_zone,
    start_on: input.start_on,
    pause_on: input.pause_on,
    start_at: input.start_on ? localMidnightUtcIso(input.start_on, input.time_zone) : null,
    pause_at: input.pause_on ? localMidnightUtcIso(input.pause_on, input.time_zone) : null,
  };
}

export function lifecycleScheduleFromRow(row: LifecycleScheduleRow | null | undefined): LifecycleScheduleView {
  const timeZone = row?.schedule_timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const startOn = parseYmd(row?.start_date ?? null);
  const pauseOn = parseYmd(row?.pause_date ?? null);
  return {
    time_zone: timeZone,
    start_on: startOn,
    pause_on: pauseOn,
    start_at: row?.start_at ?? (startOn ? localMidnightUtcIso(startOn, timeZone) : null),
    pause_at: row?.pause_at ?? (pauseOn ? localMidnightUtcIso(pauseOn, timeZone) : null),
  };
}

export function parseLifecycleScheduleBody(
  value: unknown,
): { ok: true; value: LifecycleScheduleInput | null } | { ok: false; error: LifecycleValidationError } {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (value === undefined) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'lifecycle_schedule must be an object or null',
        param: 'lifecycle_schedule',
      },
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'lifecycle_schedule must be an object or null',
        param: 'lifecycle_schedule',
      },
    };
  }
  const body = value as Record<string, unknown>;
  const extra = Object.keys(body).filter(
    (key) => !['time_zone', 'start_on', 'pause_on', 'start_at', 'pause_at'].includes(key),
  );
  if (extra.length > 0) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: `Unknown lifecycle_schedule field: ${extra[0]}`,
        param: `lifecycle_schedule.${extra[0]}`,
      },
    };
  }
  if (typeof body.time_zone !== 'string' || !body.time_zone.trim()) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'lifecycle_schedule.time_zone is required',
        param: 'lifecycle_schedule.time_zone',
      },
    };
  }
  const timeZone = body.time_zone.trim();
  if (!isValidIanaTimeZone(timeZone)) {
    return {
      ok: false,
      error: {
        code: 'invalid_timezone',
        message: `Unknown IANA timezone: ${timeZone}`,
        param: 'lifecycle_schedule.time_zone',
      },
    };
  }
  if (!('start_on' in body) || !('pause_on' in body)) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'lifecycle_schedule requires start_on and pause_on (nullable dates)',
        param: 'lifecycle_schedule',
      },
    };
  }
  const startOn = parseOptionalYmdField(body.start_on, 'lifecycle_schedule.start_on');
  if (!startOn.ok) return startOn;
  const pauseOn = parseOptionalYmdField(body.pause_on, 'lifecycle_schedule.pause_on');
  if (!pauseOn.ok) return pauseOn;
  return {
    ok: true,
    value: {
      time_zone: timeZone,
      start_on: startOn.value,
      pause_on: pauseOn.value,
    },
  };
}

function parseOptionalYmdField(
  value: unknown,
  param: string,
): { ok: true; value: string | null } | { ok: false; error: LifecycleValidationError } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: `${param} must be a YYYY-MM-DD date or null`,
        param,
      },
    };
  }
  const parsed = parseYmd(value);
  if (!parsed) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: `${param} must be a valid YYYY-MM-DD date`,
        param,
      },
    };
  }
  return { ok: true, value: parsed };
}

export function validateLifecycleSchedule(
  input: LifecycleScheduleInput,
  now: Date = new Date(),
): LifecycleValidationError | null {
  if (!isValidIanaTimeZone(input.time_zone)) {
    return {
      code: 'invalid_timezone',
      message: `Unknown IANA timezone: ${input.time_zone}`,
      param: 'lifecycle_schedule.time_zone',
    };
  }
  if (input.start_on && input.pause_on && input.pause_on <= input.start_on) {
    return {
      code: 'invalid_lifecycle_dates',
      message: 'pause_on must be after start_on',
      param: 'lifecycle_schedule.pause_on',
    };
  }
  if (input.pause_on) {
    const pauseAt = localMidnightUtcIso(input.pause_on, input.time_zone);
    if (Date.parse(pauseAt) <= now.getTime()) {
      return {
        code: 'pause_date_elapsed',
        message: 'pause_on must be a future local date',
        param: 'lifecycle_schedule.pause_on',
      };
    }
  }
  return null;
}

export function validateLifecycleScheduleForStatus(params: {
  status: CampaignStatus;
  current: LifecycleScheduleInput;
  next: LifecycleScheduleInput;
  now?: Date;
}): LifecycleValidationError | null {
  const now = params.now ?? new Date();
  const shapeError = validateLifecycleSchedule(params.next, now);
  if (shapeError) return shapeError;

  if (params.status === 'stopped') {
    if (
      params.current.time_zone !== params.next.time_zone ||
      params.current.start_on !== params.next.start_on ||
      params.current.pause_on !== params.next.pause_on
    ) {
      return {
        code: 'lifecycle_schedule_locked',
        message: 'Stopped campaigns cannot change lifecycle dates',
        param: 'lifecycle_schedule',
      };
    }
  }

  if (params.status === 'running') {
    if (params.current.start_on !== params.next.start_on) {
      return {
        code: 'start_date_locked',
        message: 'start_on cannot change after a campaign is running',
        param: 'lifecycle_schedule.start_on',
      };
    }
    if (params.current.time_zone !== params.next.time_zone) {
      return {
        code: 'timezone_locked',
        message: 'time_zone cannot change while a campaign is running',
        param: 'lifecycle_schedule.time_zone',
      };
    }
  }

  return null;
}

export function nextStatusAfterLifecycleEdit(
  status: CampaignStatus,
  nextStartOn: string | null,
  timeZone: string,
  now: Date = new Date(),
): CampaignStatus | null {
  if (status !== 'scheduled') return null;
  const launch = decideLaunchStatus(nextStartOn, timeZone, now);
  return launch === 'running' ? 'running' : 'scheduled';
}

export function canResumeWithLifecycleSchedule(
  pauseOn: string | null,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!pauseOn) return true;
  const pauseAt = localMidnightUtcIso(pauseOn, timeZone);
  return Date.parse(pauseAt) > now.getTime();
}

export function timezoneFromScheduleJson(schedule: unknown, fallback = DEFAULT_SCHEDULE_TIMEZONE): string {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return fallback;
  const timezone = (schedule as { timezone?: unknown }).timezone;
  return typeof timezone === 'string' && timezone.trim() ? timezone.trim() : fallback;
}

export function withScheduleTimezone(schedule: unknown, timeZone: string): unknown {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return schedule;
  return { ...(schedule as Record<string, unknown>), timezone: timeZone };
}

export function presentCampaignLifecycle<T extends Record<string, unknown>>(row: T): T & { lifecycle_schedule: LifecycleScheduleView } {
  const record = row as T & LifecycleScheduleRow;
  const lifecycle_schedule = lifecycleScheduleFromRow(record);
  const next: Record<string, unknown> = { ...row, lifecycle_schedule };
  for (const key of LIFECYCLE_INTERNAL_COLUMNS) {
    delete next[key];
  }
  return next as T & { lifecycle_schedule: LifecycleScheduleView };
}

export function summarizeLifecycleDates(row: LifecycleScheduleRow | null | undefined): string | null {
  const view = lifecycleScheduleFromRow(row);
  const parts: string[] = [];
  if (view.start_on) parts.push(`Starts ${formatDisplayYmd(view.start_on)}`);
  if (view.pause_on) parts.push(`Pauses ${formatDisplayYmd(view.pause_on)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatDisplayYmd(ymd: string): string {
  const parsed = parseYmd(ymd);
  if (!parsed) return ymd;
  const [year, month, day] = parsed.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
