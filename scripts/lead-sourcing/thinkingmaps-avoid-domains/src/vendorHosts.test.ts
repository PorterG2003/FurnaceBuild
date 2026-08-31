import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDirectoryHost, isJunkSearchHost, isUnusableEmailDomain, isVendorHost } from './vendorHosts.js';

describe('vendorHosts', () => {
  it('rejects CMS hosts and their subdomains as email domains', () => {
    assert.equal(isVendorHost('delrosa.edlio.com'), true);
    assert.equal(isVendorHost('https://school.finalsite.com/fs/pages'), true);
    assert.equal(isUnusableEmailDomain('edlioemail.com'), true);
    assert.equal(isVendorHost('sbcusd.com'), false);
  });

  it('rejects directories from search results', () => {
    assert.equal(isJunkSearchHost('https://www.greatschools.org/california/san-bernardino/123-del-rosa/'), true);
    assert.equal(isDirectoryHost('nces.ed.gov'), true);
    assert.equal(isJunkSearchHost('https://www.sbcusd.com/'), false);
  });
});
