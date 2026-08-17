import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVariantPerfCells } from './formatVariantPerfCells';

test('formatVariantPerfCells: paced nodes show numeric replied and interested with pct', () => {
  const cells = formatVariantPerfCells({
    priority: false,
    counts: { sent: 10, replied: 3, positiveReply: 2, bounced: 1 },
  });
  assert.deepEqual(cells, {
    sent: 10,
    bounced: { value: 1, pct: 10 },
    replied: { value: 3, pct: 30 },
    interested: { value: 2, pct: 67 },
  });
});

test('formatVariantPerfCells: priority nodes dash replied and interested', () => {
  const cells = formatVariantPerfCells({
    priority: true,
    counts: { sent: 94, replied: 0, positiveReply: 0, bounced: 2 },
  });
  assert.deepEqual(cells, {
    sent: 94,
    bounced: { value: 2, pct: 2 },
    replied: '—',
    interested: '—',
  });
});

test('formatVariantPerfCells: priority with zero sent still dashes reply cols', () => {
  const cells = formatVariantPerfCells({
    priority: true,
    counts: { sent: 0, replied: 5, positiveReply: 4, bounced: 0 },
  });
  assert.equal(cells.sent, 0);
  assert.deepEqual(cells.bounced, { value: 0, pct: 0 });
  assert.equal(cells.replied, '—');
  assert.equal(cells.interested, '—');
});
