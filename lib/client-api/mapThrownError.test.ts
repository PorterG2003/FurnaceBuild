import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapClientApiThrownError,
  publicErrorMessageFromThrown,
} from './mapThrownError.js';

test('mapClientApiThrownError maps uuid syntax to invalid_id', () => {
  const mapped = mapClientApiThrownError(
    new Error('Failed to list threads: invalid input syntax for type uuid: "nope"'),
  );
  assert.ok(mapped);
  assert.equal(mapped?.status, 400);
  assert.equal(mapped?.code, 'invalid_id');
});

test('mapClientApiThrownError maps timestamp syntax to invalid_datetime', () => {
  const mapped = mapClientApiThrownError(
    new Error('Failed to list threads: invalid input syntax for type timestamp with time zone: "not-a-date"'),
  );
  assert.ok(mapped);
  assert.equal(mapped?.status, 400);
  assert.equal(mapped?.code, 'invalid_datetime');
});

test('mapClientApiThrownError maps unicode escape to invalid_string', () => {
  const mapped = mapClientApiThrownError(
    new Error('Failed to create campaign: unsupported Unicode escape sequence'),
  );
  assert.ok(mapped);
  assert.equal(mapped?.status, 400);
  assert.equal(mapped?.code, 'invalid_string');
});

test('publicErrorMessageFromThrown strips HTML gateway bodies', () => {
  const html = `<!DOCTYPE html><html><body>Attention Required! | Cloudflare</body></html>`;
  const message = publicErrorMessageFromThrown(
    new Error(`Failed to list campaigns: ${html}`),
  );
  assert.equal(message, 'Upstream request failed');
  assert.doesNotMatch(message, /<!DOCTYPE/i);
  assert.doesNotMatch(message, /<html/i);
});

test('mapClientApiThrownError returns null for unrelated errors', () => {
  assert.equal(mapClientApiThrownError(new Error('something else')), null);
});
