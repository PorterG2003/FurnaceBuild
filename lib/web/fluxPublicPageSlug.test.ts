import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  fluxPublicPageCanonicalPath,
  fluxPublicPageTrailingSlashPath,
  normalizeSlugParam,
  resolveFluxPublicPageSlug,
  slugFromFluxPublicPathname,
} from './fluxPublicPageSlug';

describe('slugFromFluxPublicPathname', () => {
  it('parses /p/{slug} with and without trailing slash', () => {
    assert.strictEqual(slugFromFluxPublicPathname('/p/purept'), 'purept');
    assert.strictEqual(slugFromFluxPublicPathname('/p/purept/'), 'purept');
    assert.strictEqual(slugFromFluxPublicPathname('/p/craniosacralgr/'), 'craniosacralgr');
  });

  it('rejects nested or invalid paths', () => {
    assert.strictEqual(slugFromFluxPublicPathname('/p'), undefined);
    assert.strictEqual(slugFromFluxPublicPathname('/p/'), undefined);
    assert.strictEqual(slugFromFluxPublicPathname('/p/foo/bar'), undefined);
    assert.strictEqual(slugFromFluxPublicPathname('/flux/purept'), undefined);
  });
});

describe('fluxPublicPageTrailingSlashPath', () => {
  it('detects trailing-slash Flux public URLs', () => {
    assert.strictEqual(fluxPublicPageTrailingSlashPath('/p/purept/'), '/p/purept');
    assert.strictEqual(fluxPublicPageTrailingSlashPath('/p/purept'), null);
    assert.strictEqual(fluxPublicPageCanonicalPath('/p/purept/', '?utm=1', '#x'), '/p/purept?utm=1#x');
  });
});

describe('resolveFluxPublicPageSlug', () => {
  it('prefers route params over pathname', () => {
    assert.strictEqual(resolveFluxPublicPageSlug('peakpt', '/p/other/'), 'peakpt');
  });

  it('falls back to pathname when params are empty (Amplify trailing slash)', () => {
    assert.strictEqual(resolveFluxPublicPageSlug('', '/p/purept/'), 'purept');
    assert.strictEqual(resolveFluxPublicPageSlug(undefined, '/p/purept/'), 'purept');
    assert.strictEqual(normalizeSlugParam(['']), undefined);
  });
});
