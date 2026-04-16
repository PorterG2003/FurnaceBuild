import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  isIowaSosRateLimitedPage,
  looksLikeIowaSosRateLimitUrl,
  rateLimitBackoffMs,
} from './iowaRateLimit.js';

describe('iowaRateLimit', () => {
  it('detects /ratelimit/captcha URL', () => {
    assert.ok(looksLikeIowaSosRateLimitUrl('https://sos.iowa.gov/ratelimit/captcha?foo=1'));
  });

  it('detects bird copy in body', () => {
    const html = '<html><body><h1>A bird flew away with the page</h1></body></html>';
    assert.ok(isIowaSosRateLimitedPage('https://sos.iowa.gov/search/business/search.aspx', html));
  });

  it('does not flag normal results page', () => {
    const html = '<table><th>Business No.</th><th>Name</th><th>Status</th><th>Type</th></table>';
    assert.ok(!isIowaSosRateLimitedPage('https://sos.iowa.gov/search/business/results.aspx?q=x', html));
  });

  it('does not flag page that only mentions generic rate limit in script noise', () => {
    const html =
      '<html><script>/* rate limit tracking */</script><body><h1>Business Entities Search</h1></body></html>';
    assert.ok(!isIowaSosRateLimitedPage('https://sos.iowa.gov/search/business/search.aspx', html));
  });

  it('rateLimitBackoffMs is bounded', () => {
    const m = rateLimitBackoffMs(10);
    assert.ok(m <= 300_000);
    assert.ok(m >= 30_000);
  });
});
