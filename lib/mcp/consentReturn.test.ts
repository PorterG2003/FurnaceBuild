import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMcpConsentAuthHref,
  isMcpConsentPath,
  parseMcpConsentReturnTo,
} from './consentReturn';

describe('parseMcpConsentReturnTo', () => {
  it('accepts consent path with OAuth query', () => {
    const withEncodedRedirect =
      '/mcp/oauth/consent?client_id=abc&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback';
    const withPlainRedirect =
      '/mcp/oauth/consent?client_id=abc&redirect_uri=http://localhost:8787/callback';
    assert.equal(parseMcpConsentReturnTo(withPlainRedirect), withPlainRedirect);
    assert.equal(parseMcpConsentReturnTo(withEncodedRedirect), withPlainRedirect);
    // Router typically decodes return_to once; result must still validate.
    const fromAuthQuery = decodeURIComponent(encodeURIComponent(withPlainRedirect));
    assert.equal(parseMcpConsentReturnTo(fromAuthQuery), withPlainRedirect);
  });

  it('rejects open redirects and unrelated paths', () => {
    assert.equal(parseMcpConsentReturnTo('https://evil.example/mcp/oauth/consent'), null);
    assert.equal(parseMcpConsentReturnTo('//evil.example/mcp/oauth/consent'), null);
    assert.equal(parseMcpConsentReturnTo('/account'), null);
    assert.equal(parseMcpConsentReturnTo('/mcp/oauth/consent/extra'), null);
    assert.equal(parseMcpConsentReturnTo(''), null);
    assert.equal(parseMcpConsentReturnTo(undefined), null);
  });
});

describe('buildMcpConsentAuthHref', () => {
  it('encodes a safe return_to', () => {
    const href = buildMcpConsentAuthHref('/mcp/oauth/consent?client_id=x');
    assert.equal(
      href,
      `/auth?return_to=${encodeURIComponent('/mcp/oauth/consent?client_id=x')}`,
    );
  });
});

describe('isMcpConsentPath', () => {
  it('matches consent path', () => {
    assert.equal(isMcpConsentPath('/mcp/oauth/consent'), true);
    assert.equal(isMcpConsentPath('/mcp/oauth/consent/'), true);
    assert.equal(isMcpConsentPath('/mcp'), false);
  });
});
