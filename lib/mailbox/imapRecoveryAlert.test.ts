import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allFailuresAreInfraClass,
  inferImapInfraFailureCode,
  isSystemicInfraFailure,
} from './imapRecoveryAlert.ts';

test('inferImapInfraFailureCode ignores auth-style XOAUTH2 failures', () => {
  assert.equal(
    inferImapInfraFailureCode({
      message:
        'Command failed — NO 1 NO Cannot get connection: dialing upstream: XOAUTH2 auth: imap: NO Login failed.',
    }),
    null,
  );
});

test('inferImapInfraFailureCode recognizes host-level outage patterns from code or message', () => {
  assert.equal(inferImapInfraFailureCode({ code: 'ETIMEDOUT', message: 'timeout' }), 'ETIMEDOUT');
  assert.equal(
    inferImapInfraFailureCode({ message: 'getaddrinfo ENOTFOUND clinicfoottrafficcocom.austin.inboxalways.com' }),
    'ENOTFOUND',
  );
});

test('isSystemicInfraFailure requires the same infra code on the same host', () => {
  assert.equal(
    isSystemicInfraFailure([
      { host: 'proxy.example.com', code: 'ETIMEDOUT', message: 'timeout' },
      { host: 'proxy.example.com', code: 'ETIMEDOUT', message: 'timeout' },
    ]),
    true,
  );
  assert.equal(
    isSystemicInfraFailure([
      { host: 'proxy.example.com', code: null, message: 'XOAUTH2 auth: imap: NO Login failed' },
      { host: 'proxy.example.com', code: null, message: 'XOAUTH2 auth: imap: NO Login failed' },
    ]),
    false,
  );
  assert.equal(
    isSystemicInfraFailure([
      { host: 'proxy-a.example.com', code: 'ETIMEDOUT', message: 'timeout' },
      { host: 'proxy-b.example.com', code: 'ETIMEDOUT', message: 'timeout' },
    ]),
    false,
  );
});

test('allFailuresAreInfraClass accepts mixed hosts with infra codes', () => {
  assert.equal(
    allFailuresAreInfraClass([
      { host: 'proxy-a.example.com', code: 'ECONNREFUSED', message: 'refused' },
      { host: 'proxy-b.example.com', code: 'ETIMEDOUT', message: 'timeout' },
    ]),
    true,
  );
  assert.equal(
    allFailuresAreInfraClass([
      { host: 'proxy-a.example.com', code: 'ECONNREFUSED', message: 'refused' },
      { host: 'proxy-b.example.com', code: null, message: 'Authentication failed' },
    ]),
    false,
  );
});
