import assert from 'node:assert/strict';
import test from 'node:test';
import { getBearerToken, hashApiKey, isApiKeyExpired } from './auth.js';

test('hashApiKey is stable for the same secret', () => {
  assert.equal(
    hashApiKey('f_test_secret'),
    hashApiKey('f_test_secret'),
  );
});

test('getBearerToken extracts bearer tokens and ignores other auth schemes', () => {
  assert.equal(getBearerToken('Bearer f_test_secret'), 'f_test_secret');
  assert.equal(getBearerToken('Basic abc123'), null);
  assert.equal(getBearerToken(null), null);
});

test('isApiKeyExpired only expires timestamps in the past', () => {
  assert.equal(isApiKeyExpired(new Date(Date.now() - 60_000).toISOString()), true);
  assert.equal(isApiKeyExpired(new Date(Date.now() + 60_000).toISOString()), false);
  assert.equal(isApiKeyExpired(null), false);
});
