import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseOutOfOfficeReturnDate } from './parseOutOfOfficeReturnDate';

describe('parseOutOfOfficeReturnDate', () => {
  const ref = new Date(Date.UTC(2026, 3, 29, 15, 0, 0)); // 2026-04-29

  it('returns null for empty input', () => {
    assert.strictEqual(parseOutOfOfficeReturnDate('', ref), null);
    assert.strictEqual(parseOutOfOfficeReturnDate(null, ref), null);
  });

  it('parses ISO date', () => {
    const d = parseOutOfOfficeReturnDate('I will return on 2026-05-12 for meetings.', ref);
    assert.ok(d);
    assert.strictEqual(d!.toISOString().slice(0, 10), '2026-05-12');
  });

  it('parses US slash date', () => {
    const d = parseOutOfOfficeReturnDate('Back on 05/12/2026. Thanks!', ref);
    assert.ok(d);
    assert.strictEqual(d!.toISOString().slice(0, 10), '2026-05-12');
  });

  it('parses Month DD, YYYY', () => {
    const d = parseOutOfOfficeReturnDate('I will return on Monday, April 29, 2026.', ref);
    assert.ok(d);
    assert.strictEqual(d!.toISOString().slice(0, 10), '2026-04-29');
  });

  it('ignores quoted reply lines', () => {
    const body = '> old line\nI return on 2026-06-01.\n';
    const d = parseOutOfOfficeReturnDate(body, ref);
    assert.ok(d);
    assert.strictEqual(d!.toISOString().slice(0, 10), '2026-06-01');
  });

  it('returns null when no date pattern', () => {
    assert.strictEqual(parseOutOfOfficeReturnDate('Out of office. Email urgent items.', ref), null);
  });
});
