import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Mailbox, MessageJob, Lead } from './types.js';
import { randomBytes } from 'crypto';
import {
  buildStableSubmittedMessageId,
  formatMessageId,
  formatReferencesHeader,
  normalizeMessageId,
  parseMessageIds,
} from '@furnace/email-lib';

/**
 * Convert data URL images in HTML to CID inline attachments.
 * Extracts img src="data:image/...;base64,..." and replaces with cid:xxx.
 * Returns processed HTML and attachments array for nodemailer.
 */
export function processInlineImagesForEmail(html: string): {
  html: string;
  attachments: nodemailer.SendMailOptions['attachments'];
} {
  const attachments: nodemailer.SendMailOptions['attachments'] = [];

  const processedHtml = html.replace(
    /<img([^>]*?)src="(data:image\/([^;]+);base64,([^"]+))"([^>]*)>/gi,
    (_match, before, _dataUrl, subtype, base64Data, after) => {
      const ext = subtype.toLowerCase() === 'jpeg' ? 'jpg' : subtype.toLowerCase();
      const cid = `${randomBytes(8).toString('hex')}@furnace.inline`;

      attachments.push({
        filename: `image.${ext}`,
        content: Buffer.from(base64Data, 'base64'),
        cid,
      });

      return `<img${before}src="cid:${cid}"${after}>`;
    }
  );

  return { html: processedHtml, attachments };
}

/**
 * Create SMTP transporter for a mailbox
 */
export function createTransporter(mailbox: Mailbox): Transporter {
  return nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_use_ssl, // true for 465, false for other ports
    requireTLS: mailbox.smtp_use_tls,
    auth: {
      user: mailbox.smtp_username,
      pass: mailbox.smtp_password, // TODO: Decrypt if encrypted in database
    },
    // Connection pool settings
    pool: true,
    maxConnections: mailbox.smtp_connection_limit ?? 5,
    maxMessages: mailbox.smtp_messages_per_connection ?? 100,
  });
}

/**
 * Generate unique Message-ID header for reply detection
 */
export function generateMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `<${timestamp}.${random}@furnace.build>`;
}

/**
 * Strip HTML tags to produce plain text fallback.
 * Exported for use in worker when deriving plain-text body from final HTML (e.g. after appending signature).
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export type SendEmailResult = {
  submittedMessageId: string;
  providerMessageId: string;
};

export type SendEmailOptions = {
  bodyHtml?: string;
  bodyText?: string;
  /** Stable Message-ID to submit (defaults to job-derived ID). */
  messageId?: string | null;
  /** Outlook Thread-Topic (textual). Never synthesize Thread-Index. */
  threadTopic?: string | null;
};

function resolveSubmittedMessageId(job: MessageJob, explicit?: string | null): string {
  if (explicit) {
    const formatted = formatMessageId(explicit);
    if (formatted) return formatted;
  }
  return buildStableSubmittedMessageId(job.id);
}

function buildThreadingMailFields(params: {
  inReplyTo?: string | null;
  references?: string | null;
}): Pick<nodemailer.SendMailOptions, 'inReplyTo' | 'references'> {
  const inReplyTo = formatMessageId(params.inReplyTo) ?? undefined;
  const refIds = parseMessageIds(params.references ?? null);
  const references = formatReferencesHeader(refIds) ?? undefined;
  return { inReplyTo, references };
}

/**
 * Send email via SMTP.
 * Accepts body (plain) or bodyHtml+bodyText for rich emails.
 * Uses Nodemailer messageId / inReplyTo / references (not custom protected headers).
 */
export async function sendEmail(
  transporter: Transporter,
  mailbox: Mailbox,
  job: MessageJob,
  lead: Lead,
  subject: string,
  body: string,
  inReplyTo?: string | null,
  references?: string | null,
  options?: SendEmailOptions
): Promise<SendEmailResult> {
  const submittedMessageId = resolveSubmittedMessageId(job, options?.messageId);
  const headers: Record<string, string> = {
    'X-Message-ID': job.id, // Track our internal message_job_id
  };
  if (options?.threadTopic) {
    headers['Thread-Topic'] = options.threadTopic;
  }

  let text: string;
  let html: string;
  let attachments: nodemailer.SendMailOptions['attachments'];

  if (options?.bodyHtml) {
    const { html: processedHtml, attachments: inlineAttachments } = processInlineImagesForEmail(options.bodyHtml);
    html = processedHtml;
    attachments = inlineAttachments;
    text = options.bodyText?.trim() || stripHtml(html) || body;
  } else {
    // Prefer non-empty plain body; fall back to bodyText so blank merged HTML
    // cannot wipe a populated text part (API template-only / signature edge cases).
    const plain =
      String(body ?? '').trim() ||
      String(options?.bodyText ?? '').trim() ||
      String(body ?? '');
    text = plain;
    html = plain;
    attachments = undefined;
  }

  const threading = buildThreadingMailFields({ inReplyTo, references });

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${mailbox.display_name}" <${mailbox.email_address}>`,
    to: lead.email,
    subject: subject,
    text,
    html,
    attachments,
    messageId: submittedMessageId,
    ...threading,
    headers,
  };

  const info = await transporter.sendMail(mailOptions);
  const providerMessageId =
    formatMessageId(info.messageId) ||
    normalizeMessageId(info.messageId) ||
    submittedMessageId;

  return {
    submittedMessageId,
    providerMessageId: formatMessageId(providerMessageId) || submittedMessageId,
  };
}

export interface ReplyEmailOptions {
  toEmail: string;
  toName?: string | null;
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  messageId?: string | null;
  threadTopic?: string | null;
  /** File attachments (content = base64). Merged with inline image attachments when sending. */
  attachments?: Array<{ filename: string; contentType?: string; content: string }>;
}

/**
 * Send reply email via SMTP (inbox reply/forward)
 * Sets In-Reply-To and References for threading.
 */
export async function sendReplyEmail(
  transporter: Transporter,
  mailbox: Mailbox,
  job: MessageJob,
  options: ReplyEmailOptions
): Promise<SendEmailResult> {
  const submittedMessageId = resolveSubmittedMessageId(job, options.messageId);
  const headers: Record<string, string> = {
    'X-Message-ID': job.id,
  };
  if (options.threadTopic) {
    headers['Thread-Topic'] = options.threadTopic;
  }

  const bodyHtml = options.bodyHtml || options.bodyText;
  const { html: processedHtml, attachments: inlineAttachments } = processInlineImagesForEmail(bodyHtml);

  const allAttachments: nodemailer.SendMailOptions['attachments'] = [...(inlineAttachments || [])];
  if (options.attachments && options.attachments.length > 0) {
    for (const att of options.attachments) {
      const content = typeof (att as { content?: string }).content === 'string' ? (att as { content: string }).content : '';
      const contentType = (att as { contentType?: string }).contentType ?? (att as { content_type?: string }).content_type;
      if (!content) continue;
      allAttachments.push({
        filename: (att as { filename?: string }).filename ?? 'attachment',
        content: Buffer.from(content, 'base64'),
        contentType: contentType || undefined,
      });
    }
  }
  console.log(`[SEND WORKER] sendReplyEmail: ${options.attachments?.length ?? 0} file attachment(s), ${allAttachments.length} total (incl. inline)`);

  const threading = buildThreadingMailFields({
    inReplyTo: options.inReplyTo,
    references: options.references,
  });

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${mailbox.display_name || mailbox.email_address}" <${mailbox.email_address}>`,
    to: options.toName ? `"${options.toName}" <${options.toEmail}>` : options.toEmail,
    cc: options.cc && options.cc.length > 0 ? options.cc : undefined,
    subject: options.subject,
    text: options.bodyText,
    html: processedHtml,
    attachments: allAttachments.length > 0 ? allAttachments : undefined,
    messageId: submittedMessageId,
    ...threading,
    headers,
  };

  const info = await transporter.sendMail(mailOptions);
  const providerMessageId =
    formatMessageId(info.messageId) ||
    normalizeMessageId(info.messageId) ||
    submittedMessageId;

  return {
    submittedMessageId,
    providerMessageId: formatMessageId(providerMessageId) || submittedMessageId,
  };
}
