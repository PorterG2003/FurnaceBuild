import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnknownError } from './reportErrorToSlack.js';

test('formatUnknownError unwraps plain object with message', () => {
  const out = formatUnknownError({ message: 'upstream timeout', code: '57014' });
  assert.match(out, /upstream timeout/);
  assert.match(out, /code=57014/);
});

test('formatUnknownError handles Error instances', () => {
  assert.equal(formatUnknownError(new Error('boom')), 'boom');
});

test('formatUnknownError avoids [object Object] for plain objects', () => {
  assert.notEqual(formatUnknownError({ foo: 1 }), '[object Object]');
});
