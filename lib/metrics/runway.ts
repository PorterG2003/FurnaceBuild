const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Queue runway in weeks from live daily send capacity (unique mailboxes × daily limit).
 * Returns null when there is no capacity.
 */
export function queueRunwayWeeks(leadsInQueue: number, dailyEmails: number): number | null {
  const days = queueRunwayDays(leadsInQueue, dailyEmails);
  if (days == null) return null;
  return Math.round((days / 7) * 10) / 10;
}

export function queueRunwayDays(leadsInQueue: number, dailyEmails: number): number | null {
  if (leadsInQueue < 0) return null;
  if (dailyEmails <= 0) return null;
  return leadsInQueue / dailyEmails;
}

export function queueRunwayEndDate(
  leadsInQueue: number,
  dailyEmails: number,
  now: Date = new Date(),
): Date | null {
  const days = queueRunwayDays(leadsInQueue, dailyEmails);
  if (days == null) return null;
  const wholeDays = Math.max(0, Math.round(days));
  const end = startOfLocalDay(now);
  end.setDate(end.getDate() + wholeDays);
  return end;
}

export function formatRelativeDay(date: Date, now: Date = new Date()): string {
  const target = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  const diffDays = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays < 7) {
    return target.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return target.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: target.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatRunwayThrough(
  endDate: Date | null,
  now: Date = new Date(),
): string | null {
  if (endDate == null) return null;
  return `Through ${formatRelativeDay(endDate, now)}`;
}

export function formatRunwayWeeks(weeks: number | null): string {
  if (weeks == null) return '—';
  if (weeks < 0.1) return '<0.1 wks';
  return `${weeks} wks`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
