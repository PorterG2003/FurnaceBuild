/**
 * Human-readable relative activity labels (Today, Yesterday, N days ago, etc.).
 * Uses calendar-day boundaries in the local timezone.
 */
export function formatRelativeActivity(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diffDays = Math.floor((today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays < 0) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  const weeks = Math.floor(diffDays / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;

  const months = Math.floor(diffDays / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(diffDays / 365);
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
}
