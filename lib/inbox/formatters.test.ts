import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLeadLastRepliedAt, formatThreadDateWithTime } from './formatters';

test('formatLeadLastRepliedAt prefixes the thread date/time label', () => {
  const iso = '2026-02-14T22:52:00.000Z';
  assert.equal(
    formatLeadLastRepliedAt(iso),
    `Lead replied at ${formatThreadDateWithTime(iso)}`,
  );
});
