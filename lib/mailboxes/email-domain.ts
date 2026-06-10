/**
 * Extract domain from email (part after @). Returns null if malformed.
 */
export function getDomainFromEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1 || atIndex === trimmed.length - 1) return null;
  return trimmed.slice(atIndex + 1);
}
