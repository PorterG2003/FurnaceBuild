import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTransientUpstreamGatewayErrorMessage,
  summarizeUpstreamGatewayError,
} from './summarizeUpstreamGatewayError.js';

const minimalCf502Html =
  '<html><head></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html>';

test('summarizeUpstreamGatewayError detects minimal Cloudflare 502 HTML', () => {
  const s = summarizeUpstreamGatewayError(minimalCf502Html);
  assert.ok(s);
  assert.match(s!.error, /Transient HTTP 502/);
  assert.match(s!.action, /status\.supabase\.com/);
  assert.ok(!s!.action.includes('scheduler will retry on the next tick'));
});

test('isTransientUpstreamGatewayErrorMessage true for raw Cloudflare HTML', () => {
  assert.equal(isTransientUpstreamGatewayErrorMessage(minimalCf502Html), true);
});

test('isTransientUpstreamGatewayErrorMessage true for summarized one-liner', () => {
  const summarized =
    'Transient HTTP 502 from Supabase (Cloudflare could not get a valid response from origin). Not a bug in our query or scheduler logic.';
  assert.equal(isTransientUpstreamGatewayErrorMessage(summarized), true);
});

test('isTransientUpstreamGatewayErrorMessage false for unrelated errors', () => {
  assert.equal(isTransientUpstreamGatewayErrorMessage('relation "foo" does not exist'), false);
  assert.equal(isTransientUpstreamGatewayErrorMessage(''), false);
});
