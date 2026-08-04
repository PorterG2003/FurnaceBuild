/**
 * Quote utilities for reply/forward: escape HTML, build forwarded conversation HTML.
 */
import {
  getDisplayBody,
  plainTextEmailBodyToForwardHtml,
  sanitizeEmailBody,
  sanitizeEmailHtmlForForwardEmbed,
} from '@/lib/email';
import type { EmailMessage } from '@/lib/supabase/types';
import { formatMessageDate, resolveToAddresses } from './formatters';

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
  const addresses = resolveToAddresses({
    toName: message.to_name,
    toEmail: message.to_email,
    toEmails: message.to_emails,
  });
  if (addresses.length === 0) {
    return escapeHtml(message.to_email);
  }
  if (addresses.length === 1 && message.to_name?.trim()) {
    return `"${escapeHtml(message.to_name.trim())}" &lt;${escapeHtml(addresses[0])}&gt;`;
  }
  return addresses.map((email) => escapeHtml(email)).join(', ');
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

function displayBodyText(message: EmailMessage): string {
  const textBody = message.body_text?.trim() ?? '';
  if (textBody) {
    return getDisplayBody(textBody, { format: 'text' });
  }
  const htmlBody = message.body_html?.trim() ?? '';
  if (!htmlBody) return '';
  const htmlWithBreaks = sanitizeEmailBody(htmlBody, { format: 'html' })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|li|tr|h[1-6])>/gi, '\n');
  const htmlAsText = htmlWithBreaks
    .replace(/<[^>]*>/g, ' ')
    .replace(/(^|\n)(\s*on\s+[^\n]*?wrote:)\s+/im, '$1$2\n');
  return getDisplayBody(htmlAsText, { format: 'text' });
}

function forwardedMessageBodyHtml(message: EmailMessage): string {
  const displayText = displayBodyText(message);
  if (displayText.trim()) {
    return plainTextEmailBodyToForwardHtml(displayText);
  }
  return messageBodyFragmentHtml(message) || '(No content)';
}

function buildSingleForwardedMessageBlock(
  message: EmailMessage,
  threadSubjectFallback: string
): string {
  const subject = message.subject?.trim() || threadSubjectFallback.trim() || '(No subject)';
  const headerLines = [
    FORWARD_DELIMITER_LINE,
    `From: ${formatFromLineHtml(message)}`,
    `Date: ${escapeHtml(formatMessageDate(message.received_at))}`,
    `Subject: ${escapeHtml(subject)}`,
    `To: ${formatToLineHtml(message)}`,
  ];
  const ccLine = formatCcLineHtml(message);
  if (ccLine) {
    headerLines.push(`Cc: ${ccLine}`);
  }
  const headerHtml = headerLines.join('<br>');
  const innerHtml = forwardedMessageBodyHtml(message);

  return (
    `<div style="border-left: 3px solid #ccc; padding-left: 15px; margin: 1em 0; color: #666;">` +
    `<div style="font-size: 12px; margin-bottom: 8px;">${headerHtml}</div>` +
    `<div style="color: #333; margin-top: 0.25em;">${innerHtml}</div>` +
    `</div>`
  );
}

/**
 * Build Gmail-style forwarded message blocks for the thread up to the clicked message.
 */
export function buildForwardedConversationHtml(
  messages: EmailMessage[],
  forwardedMessage: EmailMessage,
  threadSubjectFallback: string
): string {
  const sortedMessages = [...messages].sort(
    (left, right) => new Date(left.received_at).getTime() - new Date(right.received_at).getTime()
  );
  const forwardIndex = sortedMessages.findIndex((message) => message.id === forwardedMessage.id);
  if (forwardIndex < 0) {
    return buildSingleForwardedMessageBlock(forwardedMessage, threadSubjectFallback);
  }
  return sortedMessages
    .slice(0, forwardIndex + 1)
    .map((message) => buildSingleForwardedMessageBlock(message, threadSubjectFallback))
    .join('');
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
