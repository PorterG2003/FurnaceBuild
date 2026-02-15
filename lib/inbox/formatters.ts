/**
 * Inbox formatters: dates, file sizes, date grouping.
 */
import type { EmailMessage } from '@/lib/supabase/types';
import { getDisplayBody } from '@/lib/email';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMessageDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (dateOnly.getTime() === today.getTime()) {
    return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (dateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function formatThreadDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Full date and time for thread list, no year. e.g. "Feb 14 at 10:52 PM" */
export function formatThreadDateWithTime(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${datePart} at ${timePart}`;
}

/** Date group label for dividers: Today, Yesterday, Mon Jan 27, or Jan 15, 2026 */
export function getDateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (dateOnly.getTime() === today.getTime()) return 'Today';
  if (dateOnly.getTime() === yesterday.getTime()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function groupMessagesByDate(messages: EmailMessage[]): { label: string; messages: EmailMessage[] }[] {
  const groups: { label: string; messages: EmailMessage[] }[] = [];
  let currentLabel: string | null = null;
  let currentGroup: EmailMessage[] = [];
  for (const m of messages) {
    const label = getDateGroupLabel(m.received_at);
    if (label !== currentLabel) {
      if (currentGroup.length > 0) {
        groups.push({ label: currentLabel!, messages: currentGroup });
      }
      currentLabel = label;
      currentGroup = [m];
    } else {
      currentGroup.push(m);
    }
  }
  if (currentGroup.length > 0) {
    groups.push({ label: currentLabel!, messages: currentGroup });
  }
  return groups;
}

/**
 * Parse message body for preview: strip quoted replies, signatures, HTML;
 * decode entities and normalize whitespace. Uses the same logic as full message display.
 */
export function parsePreviewText(raw: string, format?: 'text' | 'html'): string {
  if (!raw || typeof raw !== 'string') return '';
  const inferredFormat =
    format ?? (raw.includes('<') && raw.includes('>') ? 'html' : 'text');
  const display = getDisplayBody(raw, { format: inferredFormat });
  return display.replace(/\s+/g, ' ').trim();
}

/** Initials from name or email (e.g. "Sarah Johnson" -> "SJ", "sarah@co.com" -> "sa") */
export function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
    }
    return name.slice(0, 2).toUpperCase();
  }
  const local = email.split('@')[0] || '';
  return (local.slice(0, 2) || '?').toUpperCase();
}
