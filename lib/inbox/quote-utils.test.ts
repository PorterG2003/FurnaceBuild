import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { EmailMessage } from '@/lib/supabase/types';
import { buildForwardComposerHtml, buildForwardedConversationHtml } from './quote-utils';

const FORWARD_MARKER = '---------- Forwarded message ---------';

function msg(partial: Partial<EmailMessage> & Pick<EmailMessage, 'id' | 'received_at'>): EmailMessage {
  return {
    thread_id: 't1',
    account_id: 'a1',
    message_job_id: null,
    direction: 'received',
    from_email: 'from@example.com',
    from_name: 'From User',
    to_email: 'to@example.com',
    to_name: null,
    cc: null,
    subject: 'Thread subject',
    body_text: null,
    body_html: '<p>default html</p>',
    message_id: 'mid-' + partial.id,
    in_reply_to: null,
    message_references: null,
    read_at: null,
    headers: {},
    attachments: [],
    imap_uid: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  } as EmailMessage;
}

describe('buildForwardedConversationHtml', () => {
  it('includes exactly one forwarded delimiter line', () => {
    const m = msg({
      id: 'm1',
      received_at: '2026-04-01T12:00:00.000Z',
      body_html: '<p>one</p>',
    });
    const html = buildForwardedConversationHtml([m], m, 'fallback');
    const count = html.split(FORWARD_MARKER).length - 1; // single outer block
    assert.strictEqual(count, 1, 'expected single outer delimiter');
  });

  it('includes the full message chain up to the clicked bubble', () => {
    const early = msg({
      id: 'early',
      received_at: '2026-04-01T10:00:00.000Z',
      body_html: '<p>EARLY_BODY</p>',
      from_email: 'early@x.com',
      from_name: 'Early',
    });
    const late = msg({
      id: 'late',
      received_at: '2026-04-02T10:00:00.000Z',
      body_html: '<p>LATE_BODY</p>',
      from_email: 'late@x.com',
      from_name: 'Late',
    });
    const htmlEarly = buildForwardedConversationHtml([early, late], early, 'sub');
    assert.ok(htmlEarly.includes('EARLY_BODY'));
    assert.ok(!htmlEarly.includes('LATE_BODY'));
    assert.strictEqual(htmlEarly.split(FORWARD_MARKER).length - 1, 1);

    const htmlLate = buildForwardedConversationHtml([early, late], late, 'sub');
    assert.ok(htmlLate.includes('EARLY_BODY'));
    assert.ok(htmlLate.includes('LATE_BODY'));
    assert.strictEqual(htmlLate.split(FORWARD_MARKER).length - 1, 2);
  });

  it('uses display bodies for each message so nested quoted content is not duplicated', () => {
    const early = msg({
      id: 'early',
      received_at: '2026-04-01T10:00:00.000Z',
      body_html: '<p>Original message</p>',
    });
    const later = msg({
      id: 'later',
      received_at: '2026-04-02T12:00:00.000Z',
      body_html:
        '<p>New line</p><blockquote>On Mon, Apr 1, 2026 at 9:00 AM someone wrote: Original message</blockquote>',
    });
    const html = buildForwardedConversationHtml([early, later], later, 'sub');
    assert.ok(html.includes('Original message'));
    assert.ok(html.includes('New line'));
    assert.ok(!html.includes('someone wrote:'), 'quoted thread fragment should be stripped per message');
  });

  it('removes cid images from embedded message bodies', () => {
    const m = msg({
      id: 'm1',
      received_at: '2026-04-01T12:00:00.000Z',
      body_html: '<p>ok</p><img src="cid:part123" alt="x">',
    });
    const html = buildForwardedConversationHtml([m], m, 'sub');
    assert.ok(!html.includes('cid:'), 'cid images should be stripped from forward embed');
    assert.ok(html.includes('ok'), 'non-cid content preserved');
  });

  it('falls back to sanitized raw html when the display body is empty', () => {
    const m = msg({
      id: 'm1',
      received_at: '2026-04-01T12:00:00.000Z',
      body_text: null,
      body_html: '<div><img src="https://example.com/image.png" alt=""></div>',
    });
    const html = buildForwardedConversationHtml([m], m, 'sub');
    assert.ok(html.includes('https://example.com/image.png'));
  });

  it('uses each forwarded message subject with thread fallback', () => {
    const early = msg({
      id: 'early',
      received_at: '2026-04-01T10:00:00.000Z',
      subject: '',
      body_html: '<p>one</p>',
    });
    const later = msg({
      id: 'later',
      received_at: '2026-04-02T10:00:00.000Z',
      subject: 'Actual Subject',
      body_html: '<p>two</p>',
    });
    const html = buildForwardedConversationHtml([early, later], later, 'Fallback Subject');
    assert.ok(html.includes('Fallback Subject'));
    assert.ok(html.includes('Actual Subject'));
  });
});

describe('buildForwardComposerHtml', () => {
  it('wraps authored body above the forwarded quote block', () => {
    const html = buildForwardComposerHtml('<p>Author note</p>', '<div>Quoted block</div>');
    assert.ok(html.includes('Author note'));
    assert.ok(html.includes('Quoted block'));
    assert.ok(html.includes('border-top'));
  });
});
