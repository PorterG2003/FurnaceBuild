import type { BlockListEntry } from '@/lib/supabase/types';

function getDomainFromEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1 || atIndex === trimmed.length - 1) return null;
  return trimmed.slice(atIndex + 1);
}

/** Pure check — no Supabase client import (safe for unit tests). */
export function isEmailBlockedByEntries(email: string, entries: BlockListEntry[]): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const domain = getDomainFromEmail(email);

  for (const entry of entries) {
    const entryValue = entry.value.trim().toLowerCase();
    if (entry.type === 'email') {
      if (entryValue === normalizedEmail) return true;
    } else if (entry.type === 'domain' && domain) {
      if (entryValue === domain) return true;
    }
  }
  return false;
}
