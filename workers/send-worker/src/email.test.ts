import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SendMailOptions } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser } from 'mailparser';
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

function normalizeForSemanticCompare(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\r\n/g, '\n')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .toLowerCase();
}

function assertMimeSemanticParity(
  bodyText: string | null | undefined,
  bodyHtml: string | null | undefined,
  label = 'MIME body',
): void {
  const text = normalizeForSemanticCompare(bodyText);
  const html = normalizeForSemanticCompare(bodyHtml);
  assert.equal(
    html,
    text,
    `${label}: text/plain and text/html must be semantically equal\n text=${JSON.stringify(text)}\n html=${JSON.stringify(html)}`,
  );
}

async function captureRawMime(options: SendMailOptions): Promise<Buffer> {
  const composer = new MailComposer(options);
  const compiled = composer.compile();
  return await new Promise<Buffer>((resolve, reject) => {
    compiled.build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

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
    let capturedMail: SendMailOptions | null = null;
    const transporter = {
      async sendMail(options: SendMailOptions) {
        capturedMail = options;
        sent = {
          subject: options.subject,
          text: options.text,
          html: options.html,
        };
        return { messageId: '<provider@example.com>' };
      },
    };

    const result = await sendEmail(
      transporter as any,
      createMailbox(),
      createJob({ id: '11111111-1111-1111-1111-111111111111' }),
      createLead(),
      'Checking in',
      'Hello Casey Thanks, Porter',
      '<parent@furnace.build>',
      '<root@furnace.build> <parent@furnace.build>',
      {
        bodyHtml: 'Hello Casey<br><br>Thanks,<br>Porter',
        bodyText: 'Hello Casey Thanks, Porter',
        threadTopic: 'Checking in',
      }
    );

    assert.equal(result.providerMessageId, '<provider@example.com>');
    assert.equal(result.submittedMessageId, '<11111111-1111-1111-1111-111111111111@furnace.build>');
    assert.ok(sent);
    const sentMail: CapturedMail = sent;
    assert.equal(sentMail.subject, 'Checking in');
    assert.equal(sentMail.text, 'Hello Casey Thanks, Porter');
    assert.equal(sentMail.html, 'Hello Casey<br><br>Thanks,<br>Porter');
    assert.equal(capturedMail!.messageId, result.submittedMessageId);
    assert.equal(capturedMail!.inReplyTo, '<parent@furnace.build>');
    assert.equal(capturedMail!.references, '<root@furnace.build> <parent@furnace.build>');
    assert.equal((capturedMail!.headers as any)['Thread-Topic'], 'Checking in');
    assert.equal((capturedMail!.headers as any)['In-Reply-To'], undefined);

    const raw = await captureRawMime(capturedMail!);
    const parsed = await simpleParser(raw);
    assert.equal(parsed.subject, 'Checking in');
    assert.equal(/\{[^{}\n]*\|[^{}\n]*\}/.test(String(parsed.subject ?? '')), false);
    assert.equal(String(parsed.inReplyTo ?? '').replace(/^<|>$/g, ''), 'parent@furnace.build');
    const refs = Array.isArray(parsed.references)
      ? parsed.references
      : String(parsed.references ?? '')
          .split(/\s+/)
          .filter(Boolean);
    assert.ok(refs.some((r) => String(r).includes('parent@furnace.build')));
    assertMimeSemanticParity(String(parsed.text ?? ''), String(parsed.html ?? ''), 'parsed MIME');
  });

  it('raw MIME text/html parts stay semantically equivalent for mismatched-looking html', async () => {
    let capturedMail: SendMailOptions | null = null;
    const transporter = {
      async sendMail(options: SendMailOptions) {
        capturedMail = options;
        return { messageId: '<provider@example.com>' };
      },
    };

    await sendEmail(
      transporter as any,
      createMailbox(),
      createJob({ id: '22222222-2222-2222-2222-222222222222' }),
      createLead(),
      'Parity check',
      'Hello Casey\n\nThanks,\nPorter',
      null,
      null,
      {
        bodyHtml: '<p>Hello Casey</p><p>Thanks,<br>Porter</p>',
        bodyText: 'Hello Casey\n\nThanks,\nPorter',
      }
    );

    assert.ok(capturedMail);
    const raw = await captureRawMime(capturedMail!);
    const parsed = await simpleParser(raw);
    assert.equal(parsed.subject, 'Parity check');
    assertMimeSemanticParity(String(parsed.text ?? ''), String(parsed.html ?? ''), 'MIME parity');
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

  it('preserves full-document html payloads', async () => {
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
      'Full document',
      'fallback body',
      null,
      null,
      {
        bodyHtml: '<!DOCTYPE html><html><body><table><tr><td>Hello Casey</td></tr></table></body></html>',
      }
    );

    assert.ok(sent);
    const sentMail: Pick<CapturedMail, 'text' | 'html'> = sent;
    assert.match(String(sentMail.html), /<html>/i);
    assert.match(String(sentMail.html), /<table>/i);
    assert.equal(sentMail.text, 'Hello Casey');
  });

  it('uses bodyText when plain body is empty', async () => {
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
      'Blank merged body',
      '',
      null,
      null,
      {
        bodyText: 'Hey Casey, figured this might help.',
      }
    );

    assert.ok(sent);
    const sentMail: Pick<CapturedMail, 'text' | 'html'> = sent;
    assert.equal(sentMail.text, 'Hey Casey, figured this might help.');
    assert.equal(sentMail.html, 'Hey Casey, figured this might help.');
  });
});
