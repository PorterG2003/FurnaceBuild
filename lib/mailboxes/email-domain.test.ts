import test from 'node:test';
import assert from 'node:assert/strict';
import { getDomainFromEmail } from './email-domain';

test('getDomainFromEmail extracts domain from normal emails', () => {
  assert.equal(getDomainFromEmail('user@example.com'), 'example.com');
  assert.equal(
    getDomainFromEmail('user@clinicfoottrafficcocom.austin.inboxalways.com'),
    'clinicfoottrafficcocom.austin.inboxalways.com',
  );
});

test('getDomainFromEmail normalizes case and whitespace', () => {
  assert.equal(getDomainFromEmail('  User@Example.COM  '), 'example.com');
});

test('getDomainFromEmail returns null for malformed input', () => {
  assert.equal(getDomainFromEmail('not-an-email'), null);
  assert.equal(getDomainFromEmail('user@'), null);
  assert.equal(getDomainFromEmail('@example.com'), 'example.com');
});
