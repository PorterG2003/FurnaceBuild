import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FLUX_TRANSPARENCY_REGION,
  fluxServiceAreaTransparencyRegion,
  fluxServiceAreaTransparencyRegionFromRaw,
  isValidFluxServiceArea,
  normalizeFluxRegionCode,
} from './fluxServiceArea';

test('normalizeFluxRegionCode accepts ISO alpha-2', () => {
  assert.equal(normalizeFluxRegionCode(' ca '), 'CA');
  assert.equal(normalizeFluxRegionCode('US'), 'US');
  assert.equal(normalizeFluxRegionCode('usa'), null);
});

test('fluxServiceAreaTransparencyRegion defaults to US', () => {
  assert.equal(fluxServiceAreaTransparencyRegion(null), DEFAULT_FLUX_TRANSPARENCY_REGION);
  assert.equal(
    fluxServiceAreaTransparencyRegion({
      placeId: 'x',
      formattedAddress: 'Toronto, ON',
      latitude: 43.65,
      longitude: -79.38,
    }),
    DEFAULT_FLUX_TRANSPARENCY_REGION,
  );
  assert.equal(
    fluxServiceAreaTransparencyRegion({
      placeId: 'x',
      formattedAddress: 'Toronto, ON',
      latitude: 43.65,
      longitude: -79.38,
      regionCode: 'CA',
    }),
    'CA',
  );
});

test('fluxServiceAreaTransparencyRegionFromRaw reads JSONB', () => {
  assert.equal(fluxServiceAreaTransparencyRegionFromRaw({ regionCode: 'DE' }), 'DE');
  assert.equal(fluxServiceAreaTransparencyRegionFromRaw({}), DEFAULT_FLUX_TRANSPARENCY_REGION);
});

test('isValidFluxServiceArea rejects invalid regionCode', () => {
  assert.equal(
    isValidFluxServiceArea({
      placeId: 'abc',
      formattedAddress: 'Paris',
      latitude: 48.8,
      longitude: 2.3,
      regionCode: 'FRANCE',
    }),
    false,
  );
  assert.equal(
    isValidFluxServiceArea({
      placeId: 'abc',
      formattedAddress: 'Paris',
      latitude: 48.8,
      longitude: 2.3,
      regionCode: 'FR',
    }),
    true,
  );
});
