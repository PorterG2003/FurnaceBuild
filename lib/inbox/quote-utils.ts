/**
 * Quote utilities for reply/forward: escape HTML, block-quote, build quoted blocks.
 */
import { getDisplayBody } from '@/lib/email/index';
import type { EmailMessage } from '@/lib/supabase/types';
import { formatMessageDate } from './formatters';

/** Escape HTML entities for safe inclusion in HTML email body */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Prefix each line with "> " for plain-text block-quote (fallback for text/plain) */
export function blockQuote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

/** Build quoted block for a single message (plain text with "> " prefix) */
export function buildQuotedMessageBlock(message: EmailMessage, threadSubject: string): string {
  const fromStr = message.from_name
    ? `"${message.from_name}" <${message.from_email}>`
    : message.from_email;
  const dateStr = formatMessageDate(message.received_at);
  const rawBody = message.body_text ?? message.body_html ?? '';
  const body = getDisplayBody(rawBody, { format: message.body_text ? 'text' : 'html' });
  const block = [
    '---------- Forwarded message ---------',
    `From: ${fromStr}`,
    `Date: ${dateStr}`,
    `Subject: ${threadSubject || '(No subject)'}`,
    '',
    body || '(No content)',
  ].join('\n');
  return blockQuote(block);
}

/** Build quoted block for a single message (HTML with border-left, Gmail-style) */
export function buildQuotedMessageBlockHtml(message: EmailMessage, threadSubject: string): string {
  const fromStr = message.from_name
    ? `"${escapeHtml(message.from_name)}" &lt;${escapeHtml(message.from_email)}&gt;`
    : escapeHtml(message.from_email);
  const dateStr = escapeHtml(formatMessageDate(message.received_at));
  const rawBody = message.body_text ?? message.body_html ?? '';
  const body = getDisplayBody(rawBody, { format: message.body_text ? 'text' : 'html' });
  const bodyEscaped = escapeHtml(body || '(No content)').replace(/\n/g, '<br>');
  const header = [
    '---------- Forwarded message ---------',
    `From: ${fromStr}`,
    `Date: ${dateStr}`,
    `Subject: ${escapeHtml(threadSubject || '(No subject)')}`,
  ].join('<br>');
  return `<div style="border-left: 3px solid #ccc; padding-left: 15px; margin: 1em 0; color: #666;"><div style="font-size: 12px; margin-bottom: 8px;">${header}</div><div style="color: #333;">${bodyEscaped}</div></div>`;
}

/** Build quoted content for forwarding entire thread (plain text) */
export function buildQuotedForwardThread(messages: EmailMessage[], threadSubject: string): string {
  return messages.map((m) => buildQuotedMessageBlock(m, threadSubject)).join('\n\n');
}

/** Build quoted content for forwarding entire thread (HTML with block styling) */
export function buildQuotedForwardThreadHtml(messages: EmailMessage[], threadSubject: string): string {
  return messages.map((m) => buildQuotedMessageBlockHtml(m, threadSubject)).join('');
}
