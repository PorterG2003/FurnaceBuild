import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Mailbox, MessageJob, Lead } from './types.js';

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
 * Merge template with lead data
 * Simple template replacement: {{field}} → lead.field
 */
export function mergeTemplate(template: string, lead: Lead): string {
  if (!template) return '';
  
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = (lead as any)[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * Send email via SMTP
 */
export async function sendEmail(
  transporter: Transporter,
  mailbox: Mailbox,
  job: MessageJob,
  lead: Lead,
  subject: string,
  body: string
): Promise<string> {
  const messageId = generateMessageId();

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${mailbox.display_name}" <${mailbox.email_address}>`,
    to: lead.email,
    subject: subject,
    text: body,
    html: body, // TODO: Support HTML emails if needed
    messageId: messageId,
    headers: {
      'X-Message-ID': job.id, // Track our internal message_job_id
    },
  };

  const info = await transporter.sendMail(mailOptions);
  
  if (!info.messageId) {
    // If nodemailer doesn't set messageId, use our generated one
    return messageId;
  }
  
  return info.messageId;
}

