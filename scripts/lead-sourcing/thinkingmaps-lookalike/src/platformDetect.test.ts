import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from './platformDetect.js';

describe('detectPlatform', () => {
  it('fingerprints Finalsite, Apptegy, and unknown HTML', () => {
    assert.equal(detectPlatform('<link href="https://resources.finalsite.net/css/x.css">'), 'finalsite');
    assert.equal(detectPlatform('<script src="https://cmsv2-shared-assets.apptegy.net/runtime.js">'), 'apptegy');
    assert.equal(detectPlatform('<meta name="generator" content="Edlio CMS">'), 'edlio');
    assert.equal(detectPlatform('<html><body>Hello</body></html>'), 'other');
  });
});
