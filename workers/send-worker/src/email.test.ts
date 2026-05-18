import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SendMailOptions } from 'nodemailer';
import {
  processInlineImagesForEmail,
  sendEmail,
  stripHtml,
} from './email.js';
import type { Lead, Mailbox, MessageJob } from './types.js';

type CapturedMail = {
  subject?: SendMailOptions['subject'];
  text?: SendMailOptions['text'];
  html?: SendMailOptions['html'];
};

function createMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mailbox-1',
    email_address: 'sender@example.com',
    display_name: 'Sender',
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_username: 'smtp-user',
    smtp_password: 'smtp-pass',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    smtp_status: 'active',
    ...overrides,
  };
}

function createJob(overrides: Partial<MessageJob> = {}): MessageJob {
  return {
    id: 'job-1',
    enrollment_id: 'enrollment-1',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    mailbox_id: 'mailbox-1',
    node_id: 'node-1',
    message_type: 'campaign',
    status: 'reserved',
    scheduled_at: '2026-05-16T00:00:00.000Z',
    reserved_at: '2026-05-16T00:00:00.000Z',
    sent_at: null,
    provider_message_id: null,
    error_message: null,
    retry_count: 0,
    message_data: {},
    sqs_message_id: null,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

function createLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    email: 'lead@example.com',
    first_name: 'Casey',
    ...overrides,
  };
}

describe('stripHtml', () => {
  it('removes tags and collapses whitespace', () => {
    assert.equal(stripHtml('<p>Hello</p><p>Casey</p>'), 'Hello Casey');
  });
});

describe('processInlineImagesForEmail', () => {
  it('replaces data-url images with cid attachments', () => {
    const result = processInlineImagesForEmail(
      '<p>Hello</p><img src="data:image/png;base64,aGVsbG8=" alt="inline">'
    );

    assert.match(result.html, /src="cid:[^"]+@furnace\.inline"/);
    assert.equal(result.attachments?.length, 1);
    assert.equal(result.attachments?.[0]?.filename, 'image.png');
  });
});

describe('sendEmail', () => {
  it('sends aligned rendered text and html parts for html emails', async () => {
    let sent: CapturedMail | null = null;
    const transporter = {
      async sendMail(options: SendMailOptions) {
        sent = {
          subject: options.subject,
          text: options.text,
          html: options.html,
        };
        return { messageId: '<provider@example.com>' };
      },
    };

    const messageId = await sendEmail(
      transporter as any,
      createMailbox(),
      createJob(),
      createLead(),
      'Checking in',
      'Hello Casey Thanks, Porter',
      null,
      null,
      {
        bodyHtml: 'Hello Casey<br><br>Thanks,<br>Porter',
        bodyText: 'Hello Casey Thanks, Porter',
      }
    );

    assert.equal(messageId, '<provider@example.com>');
    assert.ok(sent);
    const sentMail: CapturedMail = sent;
    assert.equal(sentMail.subject, 'Checking in');
    assert.equal(sentMail.text, 'Hello Casey Thanks, Porter');
    assert.equal(sentMail.html, 'Hello Casey<br><br>Thanks,<br>Porter');
  });

  it('derives text from rendered html when explicit bodyText is absent', async () => {
    let sent: Pick<CapturedMail, 'text' | 'html'> | null = null;
    const transporter = {
      async sendMail(options: SendMailOptions) {
        sent = {
          text: options.text,
          html: options.html,
        };
        return { messageId: '<provider@example.com>' };
      },
    };

    await sendEmail(
      transporter as any,
      createMailbox(),
      createJob(),
      createLead(),
      'Rendered html',
      'fallback body',
      null,
      null,
      {
        bodyHtml: 'Hello Casey<br><br>Thanks,<br>Porter',
      }
    );

    assert.ok(sent);
    const sentMail: Pick<CapturedMail, 'text' | 'html'> = sent;
    assert.equal(sentMail.text, 'Hello Casey Thanks, Porter');
    assert.equal(sentMail.html, 'Hello Casey<br><br>Thanks,<br>Porter');
  });
});
