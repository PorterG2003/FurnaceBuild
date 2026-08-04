import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatAddressDisplay,
  formatCcDisplay,
  formatLeadLastRepliedAt,
  formatThreadDateWithTime,
  formatToDisplay,
  resolveToAddresses,
} from './formatters';

test('formatLeadLastRepliedAt prefixes the thread date/time label', () => {
  const iso = '2026-02-14T22:52:00.000Z';
  assert.equal(
    formatLeadLastRepliedAt(iso),
    `Lead replied at ${formatThreadDateWithTime(iso)}`,
  );
});

test('formatAddressDisplay renders Name <email> or email alone', () => {
  assert.equal(formatAddressDisplay('Ada Lovelace', 'ada@example.com'), 'Ada Lovelace <ada@example.com>');
  assert.equal(formatAddressDisplay(null, 'ada@example.com'), 'ada@example.com');
  assert.equal(formatAddressDisplay('  Ada  ', '  ada@example.com  '), 'Ada <ada@example.com>');
  assert.equal(formatAddressDisplay(null, null), '');
});

test('resolveToAddresses prefers to_emails and falls back to to_email', () => {
  assert.deepEqual(
    resolveToAddresses({
      toName: 'Primary',
      toEmail: 'primary@example.com',
      toEmails: ['a@example.com', 'b@example.com', '  ', 'A@example.com'],
    }),
    ['a@example.com', 'b@example.com'],
  );
  assert.deepEqual(
    resolveToAddresses({ toEmail: 'legacy@example.com', toEmails: null }),
    ['legacy@example.com'],
  );
  assert.deepEqual(resolveToAddresses({ toEmail: '  ', toEmails: [] }), []);
});

test('formatToDisplay uses name only for a single recipient', () => {
  assert.equal(
    formatToDisplay({
      toName: 'Casey',
      toEmail: 'casey@example.com',
      toEmails: ['casey@example.com'],
    }),
    'Casey <casey@example.com>',
  );
  assert.equal(
    formatToDisplay({
      toName: 'Casey',
      toEmail: 'casey@example.com',
      toEmails: ['casey@example.com', 'other@example.com'],
    }),
    'casey@example.com, other@example.com',
  );
  assert.equal(
    formatToDisplay({
      toName: 'Casey',
      toEmail: 'casey@example.com',
      toEmails: null,
    }),
    'Casey <casey@example.com>',
  );
});

test('formatCcDisplay trims, drops empties, and dedupes case-insensitively', () => {
  assert.equal(formatCcDisplay(null), null);
  assert.equal(formatCcDisplay([]), null);
  assert.equal(formatCcDisplay(['  ', '']), null);
  assert.equal(
    formatCcDisplay(['Cc@Example.com', ' other@example.com ', 'cc@example.com', '  ']),
    'Cc@Example.com, other@example.com',
  );
});
