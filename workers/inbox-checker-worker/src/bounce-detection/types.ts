/**
 * Minimal message shape needed for bounce detection and matching.
 * Kept in sync with ProcessedMessage where used.
 */
export interface BounceMessageInput {
  subject: string;
  from: { address: string };
  to: Array<{ address: string }>;
  bodyText: string | null;
  bodyHtml: string | null;
  headers: Record<string, string | string[] | undefined>;
  messageId: string | null;
  uid?: number;
}

export type BounceSeverity = 'hard' | 'soft' | 'unknown';

export interface BounceClassification {
  severity: BounceSeverity;
  smtpCode?: string;
}
