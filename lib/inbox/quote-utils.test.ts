import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { EmailMessage } from '@/lib/supabase/types';
import { buildForwardedConversationHtml } from './quote-utils';

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

  it('embeds the clicked message body only (varies by which bubble you forward)', () => {
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

    const htmlLate = buildForwardedConversationHtml([early, late], late, 'sub');
    assert.ok(htmlLate.includes('LATE_BODY'));
    assert.ok(!htmlLate.includes('EARLY_BODY'));
  });

  it('does not strip nested quoted-looking content from body_html', () => {
    const inner =
      '<p>New line</p><blockquote>On Mon, Apr 1, 2026 at 9:00 AM someone wrote: prior</blockquote>';
    const m = msg({
      id: 'm1',
      received_at: '2026-04-02T12:00:00.000Z',
      body_html: inner,
    });
    const html = buildForwardedConversationHtml([m], m, 'sub');
    assert.ok(html.includes('someone wrote: prior'), 'quoted thread fragment should remain in forward HTML');
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

  it('uses forwarded message subject with thread fallback', () => {
    const m = msg({
      id: 'm1',
      received_at: '2026-04-01T12:00:00.000Z',
      subject: '',
      body_html: '<p>x</p>',
    });
    const html = buildForwardedConversationHtml([m], m, 'Fallback Subject');
    assert.ok(html.includes('Fallback Subject'));
  });
});
