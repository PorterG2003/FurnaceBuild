import assert from 'node:assert/strict';
import test from 'node:test';
import { simpleParser } from 'mailparser';
import { normalizeMailAddresses } from './imap-client.js';

test('normalizeMailAddresses trims and drops empty/malformed entries', () => {
  assert.deepEqual(
    normalizeMailAddresses({
      value: [
        { address: ' a@example.com ', name: 'A' },
        { address: '  ', name: 'Blank' },
        { address: undefined as unknown as string, name: 'Missing' },
        'bare@example.com',
        '',
      ],
    }),
    [
      { name: 'A', address: 'a@example.com' },
      { address: 'bare@example.com' },
    ],
  );
  assert.deepEqual(normalizeMailAddresses(null), []);
  assert.deepEqual(normalizeMailAddresses({ value: [] }), []);
});

test('simpleParser MIME with multi-To and Cc normalizes recipient arrays', async () => {
  const raw = [
    'From: Lead <lead@example.com>',
    'To: Porter <porter@example.com>, Other <other@example.com>, ',
    'Cc: Cc One <cc1@example.com>,  , cc2@example.com',
    'Subject: Re: Hello',
    'Message-ID: <reply@example.com>',
    'Date: Mon, 6 Apr 2026 02:58:50 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Reply body',
  ].join('\r\n');

  const mail = await simpleParser(raw);
  const to = normalizeMailAddresses(mail.to as any);
  const cc = normalizeMailAddresses(mail.cc as any);

  assert.deepEqual(
    to.map((entry) => entry.address),
    ['porter@example.com', 'other@example.com'],
  );
  assert.deepEqual(
    cc.map((entry) => entry.address),
    ['cc1@example.com', 'cc2@example.com'],
  );
});
