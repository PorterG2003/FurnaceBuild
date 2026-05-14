export function formatMailboxLimit(limit: number | null | undefined): string {
  return limit == null ? '—' : String(limit);
}

export function formatMailboxMinGap(seconds: number | null | undefined): string {
  return seconds == null ? '—' : `${seconds}s`;
}

export function formatMailboxUsage(sent: number, limit: number | null | undefined): string {
  return `${sent}/${formatMailboxLimit(limit)}`;
}

export function formatMailboxLastSent(lastSentAt: string | null | undefined): string {
  if (!lastSentAt) return 'Never';

  const date = new Date(lastSentAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const diffMs = Date.now() - date.getTime();

  if (diffMs < 0) {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) {
    return diffMinutes <= 1 ? 'Just now' : `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
