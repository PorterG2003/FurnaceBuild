import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
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

describe('normalizeSlugParam', () => {
  it('accepts a single slug and rejects multi-segment catch-all params', () => {
    assert.strictEqual(normalizeSlugParam('purept'), 'purept');
    assert.strictEqual(normalizeSlugParam(['purept']), 'purept');
    assert.strictEqual(normalizeSlugParam(['purept', 'extra']), undefined);
    assert.strictEqual(normalizeSlugParam(['']), undefined);
  });
});

describe('resolveFluxPublicPageSlug', () => {
  it('prefers route params over pathname', () => {
    assert.strictEqual(resolveFluxPublicPageSlug('peakpt', '/p/other/'), 'peakpt');
  });

  it('falls back to pathname when params are empty or invalid', () => {
    assert.strictEqual(resolveFluxPublicPageSlug('', '/p/purept/'), 'purept');
    assert.strictEqual(resolveFluxPublicPageSlug(undefined, '/p/purept/'), 'purept');
    assert.strictEqual(resolveFluxPublicPageSlug(['purept', 'extra'], '/p/purept/'), 'purept');
  });

  it('rejects nested paths instead of treating them as a valid public page', () => {
    assert.strictEqual(resolveFluxPublicPageSlug(['purept', 'extra'], '/p/purept/extra'), undefined);
  });
});
