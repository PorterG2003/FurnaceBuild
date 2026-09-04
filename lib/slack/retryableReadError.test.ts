import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableSupabaseReadError } from './retryableReadError.js';

test('isRetryableSupabaseReadError detects existing transient gateway summary', () => {
  const summarized =
    'Transient HTTP 502 from Supabase (Cloudflare could not get a valid response from origin). Not a bug in our query or scheduler logic.';
  assert.equal(isRetryableSupabaseReadError(summarized), true);
});

test('isRetryableSupabaseReadError detects upstream request timeout', () => {
  assert.equal(
    isRetryableSupabaseReadError('Campaign abc not found: upstream request timeout'),
    true
  );
});

test('isRetryableSupabaseReadError detects statement timeout', () => {
  assert.equal(
    isRetryableSupabaseReadError('Campaign abc load failed: canceling statement due to statement timeout'),
    true
  );
});

test('isRetryableSupabaseReadError detects auth clock skew', () => {
  assert.equal(
    isRetryableSupabaseReadError({ message: 'JWT issued at future' }),
    true
  );
});

test('isRetryableSupabaseReadError detects retryable HTTP statuses', () => {
  assert.equal(
    isRetryableSupabaseReadError({ message: 'PostgREST unavailable', status: 503 }),
    true
  );
});

test('isRetryableSupabaseReadError detects schema cache retries', () => {
  assert.equal(
    isRetryableSupabaseReadError('Could not query the database for the schema cache. Retrying. | code=PGRST002'),
    true
  );
});

test('isRetryableSupabaseReadError inspects details from structured Supabase errors', () => {
  assert.equal(
    isRetryableSupabaseReadError({
      message: 'Failed to load lead 123',
      details: 'canceling statement due to statement timeout',
    }),
    true
  );
});

test('isRetryableSupabaseReadError inspects hint from structured Supabase errors', () => {
  assert.equal(
    isRetryableSupabaseReadError({
      message: 'Failed to query PostgREST',
      hint: 'Could not query the database for the schema cache. Retrying.',
    }),
    true
  );
});

test('isRetryableSupabaseReadError detects Postgres deadlocks', () => {
  assert.equal(isRetryableSupabaseReadError({ code: '40P01', message: 'deadlock detected' }), true);
  assert.equal(isRetryableSupabaseReadError({ code: '40001', message: 'could not serialize access' }), true);
  assert.equal(
    isRetryableSupabaseReadError('PostgREST unavailable: deadlock detected'),
    true,
  );
});

test('isRetryableSupabaseReadError ignores unrelated errors', () => {
  assert.equal(
    isRetryableSupabaseReadError('Campaign abc has no account_id. Campaigns must be associated with an account.'),
    false
  );
  assert.equal(isRetryableSupabaseReadError(''), false);
});
