/** Minimum characters before applying free-text inbox search. */
export const INBOX_SEARCH_MIN_CHARS = 2;

/**
 * Normalize inbox search input for the list RPC.
 * Returns null when empty or shorter than the minimum (treated as no search).
 */
export function normalizeInboxSearchQuery(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length < INBOX_SEARCH_MIN_CHARS) return null;
  return trimmed;
}
