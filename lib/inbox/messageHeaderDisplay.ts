/**
 * Pure display state for MessageBubble address headers.
 */
import type { EmailMessage } from '@/lib/supabase/types';
import {
  formatAddressDisplay,
  formatCcDisplay,
  formatToDisplay,
  resolveToAddresses,
} from './formatters';

export type MessageHeaderDisplay = {
  /** Non-address subtitle (e.g. campaign name). Null when absent. */
  pendingSecondaryLabel: string | null;
  fromDisplay: string;
  toDisplay: string;
  ccDisplay: string | null;
  /** True when multi-To or any Cc — default the bubble expanded. */
  isComplexRouting: boolean;
  defaultExpanded: boolean;
  /** Collapsed one-liner, e.g. `to Porter <p@x.com> · Cc 1`. */
  summaryLine: string;
  accessibilityLabel: string;
};

function countCcAddresses(cc: string[] | null | undefined): number {
  if (!cc?.length) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const raw of cc) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

function buildSummaryLine(params: {
  toDisplay: string;
  toAddresses: string[];
  ccCount: number;
}): string {
  const { toDisplay, toAddresses, ccCount } = params;
  const toPart =
    toAddresses.length > 1
      ? `to ${toAddresses.join(', ')}`
      : toDisplay
        ? `to ${toDisplay}`
        : '';
  const ccPart = ccCount > 0 ? `Cc ${ccCount}` : '';
  if (toPart && ccPart) return `${toPart} · ${ccPart}`;
  return toPart || ccPart;
}

export function buildMessageHeaderDisplay(params: {
  message: Pick<
    EmailMessage,
    'from_name' | 'from_email' | 'to_name' | 'to_email' | 'to_emails' | 'cc'
  >;
  pendingSecondaryLabel?: string | null;
}): MessageHeaderDisplay {
  const { message } = params;
  const pendingSecondary = params.pendingSecondaryLabel?.trim()
    ? params.pendingSecondaryLabel.trim()
    : null;

  const fromDisplay = formatAddressDisplay(message.from_name, message.from_email);
  const toInput = {
    toName: message.to_name,
    toEmail: message.to_email,
    toEmails: message.to_emails,
  };
  const toAddresses = resolveToAddresses(toInput);
  const toDisplay = formatToDisplay(toInput);
  const ccDisplay = formatCcDisplay(message.cc);
  const ccCount = countCcAddresses(message.cc);
  const isComplexRouting = toAddresses.length > 1 || ccCount > 0;
  const summaryLine = buildSummaryLine({ toDisplay, toAddresses, ccCount });

  const parts = [`From: ${fromDisplay}`, `To: ${toDisplay}`];
  if (ccDisplay) {
    parts.push(`Cc: ${ccDisplay}`);
  }

  return {
    pendingSecondaryLabel: pendingSecondary,
    fromDisplay,
    toDisplay,
    ccDisplay,
    isComplexRouting,
    defaultExpanded: isComplexRouting,
    summaryLine,
    accessibilityLabel: parts.join('. '),
  };
}
