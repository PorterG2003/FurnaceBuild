import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildApolloWebhookUrl,
  extractApolloWebhookPhones,
  isUniqueViolation,
  parseApolloWebhookSessionPath,
  resolveFunctionUrlBase,
  verifyApolloWebhookSignature,
} from './apolloEnrichRoutes';

test('parseApolloWebhookSessionPath extracts session uuid', () => {
  assert.equal(
    parseApolloWebhookSessionPath('/sessions/550e8400-e29b-41d4-a716-446655440000'),
    '550e8400-e29b-41d4-a716-446655440000',
  );
  assert.equal(parseApolloWebhookSessionPath('/'), null);
  assert.equal(parseApolloWebhookSessionPath('/sessions/not-a-uuid'), null);
});

test('buildApolloWebhookUrl strips trailing slash from base', () => {
  assert.equal(
    buildApolloWebhookUrl('https://lambda.example/apollo/', 'abc'),
    'https://lambda.example/apollo/sessions/abc',
  );
});

test('resolveFunctionUrlBase uses requestContext.domainName', () => {
  assert.equal(
    resolveFunctionUrlBase({
      requestContext: { domainName: 'abc123.lambda-url.us-west-2.on.aws' },
    }),
    'https://abc123.lambda-url.us-west-2.on.aws',
  );
});

test('resolveFunctionUrlBase falls back to Host header', () => {
  assert.equal(
    resolveFunctionUrlBase({ headers: { Host: 'abc123.lambda-url.us-west-2.on.aws' } }),
    'https://abc123.lambda-url.us-west-2.on.aws',
  );
});

test('extractApolloWebhookPhones reads nested people array', () => {
  const phones = extractApolloWebhookPhones({
    people: [{ phone_numbers: [{ sanitized_number: '+15551234567' }] }],
  });
  assert.equal(phones[0]?.sanitized_number, '+15551234567');
});

test('verifyApolloWebhookSignature accepts when secret unset', () => {
  assert.equal(verifyApolloWebhookSignature('{}', undefined, undefined), true);
});

test('verifyApolloWebhookSignature validates sha256 digest', () => {
  const secret = 'test-secret';
  const body = '{"ok":true}';
  const sig = createHash('sha256').update(body + secret).digest('hex');
  assert.equal(verifyApolloWebhookSignature(body, sig, secret), true);
  assert.equal(verifyApolloWebhookSignature(body, 'bad', secret), false);
});

test('isUniqueViolation detects postgres 23505', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '23503' }), false);
});
