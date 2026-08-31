import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlNeedsBrowser } from './directoryBrowser.js';

describe('htmlNeedsBrowser', () => {
  it('uses HTTP for Finalsite, Apptegy NUXT, and JSON; browsers JS shells', () => {
    assert.equal(htmlNeedsBrowser('<div class="fsConstituentItem"></div>', 200), false);
    assert.equal(htmlNeedsBrowser('<script id="__NUXT_DATA__">[]</script>', 200), false);
    assert.equal(htmlNeedsBrowser('{"staff":[]}', 200), false);
    assert.equal(htmlNeedsBrowser('', 200), true);
    assert.equal(htmlNeedsBrowser('<html>enable javascript to run this app</html>', 200), true);
    assert.equal(
      htmlNeedsBrowser('<script src="https://cmsv2-static-cdn-prod.apptegy.net/static_js/app.js"></script>', 200),
      true,
    );
  });
});
