/**
 * Quote utilities for reply/forward: escape HTML, build forwarded conversation HTML.
 */
import {
  plainTextEmailBodyToForwardHtml,
  sanitizeEmailHtmlForForwardEmbed,
} from '@/lib/email/forward-embed';
import type { EmailMessage } from '@/lib/supabase/types';
import { formatMessageDate } from './formatters';

const FORWARD_DELIMITER_LINE = '---------- Forwarded message ---------';

/** Escape HTML entities for safe inclusion in HTML email body */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatFromLineHtml(message: EmailMessage): string {
  if (message.from_name?.trim()) {
    return `"${escapeHtml(message.from_name.trim())}" &lt;${escapeHtml(message.from_email)}&gt;`;
  }
  return escapeHtml(message.from_email);
}

function formatToLineHtml(message: EmailMessage): string {
  const email = escapeHtml(message.to_email);
  if (message.to_name?.trim()) {
    return `"${escapeHtml(message.to_name.trim())}" &lt;${email}&gt;`;
  }
  return email;
}

function formatCcLineHtml(message: EmailMessage): string | null {
  const cc = message.cc?.filter((e) => e?.trim()) ?? [];
  if (cc.length === 0) return null;
  return cc.map((e) => escapeHtml(e.trim())).join(', ');
}

function messageBodyFragmentHtml(message: EmailMessage): string {
  const htmlTrim = message.body_html?.trim() ?? '';
  if (htmlTrim.length > 0) {
    return sanitizeEmailHtmlForForwardEmbed(message.body_html);
  }
  return plainTextEmailBodyToForwardHtml(message.body_text);
}

/**
 * One Gmail-style "Forwarded message" header plus the **clicked** message’s body only.
 * That MIME already includes quoted replies up to that point; we do not concatenate
 * the whole thread (which duplicated nested quotes).
 *
 * @param _messages Reserved for callers (e.g. same list as the thread UI); body always comes from `forwardedMessage`.
 */
export function buildForwardedConversationHtml(
  _messages: EmailMessage[],
  forwardedMessage: EmailMessage,
  threadSubjectFallback: string
): string {
  const subject =
    forwardedMessage.subject?.trim() || threadSubjectFallback.trim() || '(No subject)';
  const headerLines = [
    FORWARD_DELIMITER_LINE,
    `From: ${formatFromLineHtml(forwardedMessage)}`,
    `Date: ${escapeHtml(formatMessageDate(forwardedMessage.received_at))}`,
    `Subject: ${escapeHtml(subject)}`,
    `To: ${formatToLineHtml(forwardedMessage)}`,
  ];
  const ccLine = formatCcLineHtml(forwardedMessage);
  if (ccLine) {
    headerLines.push(`Cc: ${ccLine}`);
  }
  const headerHtml = headerLines.join('<br>');

  const innerHtml = messageBodyFragmentHtml(forwardedMessage) || '(No content)';

  return (
    `<div style="border-left: 3px solid #ccc; padding-left: 15px; margin: 1em 0; color: #666;">` +
    `<div style="font-size: 12px; margin-bottom: 8px;">${headerHtml}</div>` +
    `<div style="color: #333; margin-top: 0.25em;">${innerHtml}</div>` +
    `</div>`
  );
}

export function buildForwardComposerHtml(
  authoredHtml: string,
  forwardedConversationHtml: string
): string {
  const body = authoredHtml.trim();
  const quote = forwardedConversationHtml.trim();
  if (!body) return quote;
  if (!quote) return body;
  return (
    `<div style="margin-bottom: 20px;">${body}</div>` +
    `<div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(209, 213, 219, 0.25);">` +
    `${quote}` +
    `</div>`
  );
}
