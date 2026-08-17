/** Matches send-worker throttle: COALESCE(mailboxes.daily_limit, 50). */
export const DEFAULT_MAILBOX_DAILY_LIMIT = 50;

export type MailboxDailyLimitRow = {
  id: string;
  daily_limit: number | null;
};

export type QueueSendCapacity = {
  dailyEmails: number;
  mailboxCount: number;
};

export function sumUniqueMailboxDailyLimits(mailboxes: MailboxDailyLimitRow[]): QueueSendCapacity {
  const unique = new Map<string, number>();
  for (const mailbox of mailboxes) {
    if (unique.has(mailbox.id)) continue;
    unique.set(mailbox.id, mailbox.daily_limit ?? DEFAULT_MAILBOX_DAILY_LIMIT);
  }
  let dailyEmails = 0;
  for (const limit of unique.values()) {
    dailyEmails += Math.max(0, limit);
  }
  return { dailyEmails, mailboxCount: unique.size };
}
