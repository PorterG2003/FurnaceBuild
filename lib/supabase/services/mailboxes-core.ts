import type { Mailbox } from '../types';

const DEFAULT_MAILBOX_DAILY_LIMIT = 50;
const DEFAULT_MAILBOX_HOURLY_LIMIT = 10;
const DEFAULT_MAILBOX_MIN_GAP_SECONDS = 180;

type MailboxThrottleHourlySent = Record<string, number | string | null | undefined>;

export interface MailboxThrottleOverviewRow {
  mailbox_id: string;
  sent_count: number | string | null;
  hourly_sent: MailboxThrottleHourlySent | null;
  last_sent_at: string | null;
}

export interface MailboxCampaignAssignmentRow {
  mailbox_id: string;
}

export interface MailboxOverview extends Mailbox {
  effectiveDailyLimit: number;
  effectiveHourlyLimit: number;
  effectiveMinGapSeconds: number;
  throttleTodaySent: number;
  throttleThisHourSent: number;
  throttleLastSentAt: string | null;
  activeCampaignCount: number;
}

function coerceCount(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function getMailboxOverviewUtcKeys(now: Date = new Date()) {
  return {
    date: now.toISOString().slice(0, 10),
    hourKey: String(now.getUTCHours()),
  };
}

export function mergeMailboxOverviewData(
  mailboxes: Mailbox[],
  throttles: MailboxThrottleOverviewRow[],
  activeCampaignAssignments: MailboxCampaignAssignmentRow[],
  now: Date = new Date()
): MailboxOverview[] {
  const { hourKey } = getMailboxOverviewUtcKeys(now);
  const throttleByMailboxId = new Map<string, MailboxThrottleOverviewRow>();
  const activeCampaignCountByMailboxId = new Map<string, number>();

  for (const throttle of throttles) {
    throttleByMailboxId.set(throttle.mailbox_id, throttle);
  }

  for (const assignment of activeCampaignAssignments) {
    activeCampaignCountByMailboxId.set(
      assignment.mailbox_id,
      (activeCampaignCountByMailboxId.get(assignment.mailbox_id) ?? 0) + 1
    );
  }

  return mailboxes.map((mailbox) => {
    const throttle = throttleByMailboxId.get(mailbox.id);
    const hourlySent = throttle?.hourly_sent ?? null;
    const throttleThisHourSent =
      hourlySent != null && typeof hourlySent === 'object'
        ? coerceCount(hourlySent[hourKey])
        : 0;

    return {
      ...mailbox,
      effectiveDailyLimit: mailbox.daily_limit ?? DEFAULT_MAILBOX_DAILY_LIMIT,
      effectiveHourlyLimit: mailbox.hourly_limit ?? DEFAULT_MAILBOX_HOURLY_LIMIT,
      effectiveMinGapSeconds: mailbox.min_gap_seconds ?? DEFAULT_MAILBOX_MIN_GAP_SECONDS,
      throttleTodaySent: coerceCount(throttle?.sent_count),
      throttleThisHourSent,
      throttleLastSentAt: throttle?.last_sent_at ?? null,
      activeCampaignCount: activeCampaignCountByMailboxId.get(mailbox.id) ?? 0,
    };
  });
}
