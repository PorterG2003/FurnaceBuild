import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countryRegionCodeFromPlacesAddressComponents,
  placeDetailsJsonToFluxServiceArea,
} from './parsePlacesServiceArea';

test('countryRegionCodeFromPlacesAddressComponents reads country shortText', () => {
  assert.equal(
    countryRegionCodeFromPlacesAddressComponents([
      { types: ['locality'], shortText: 'Toronto' },
      { types: ['country'], shortText: 'CA' },
    ]),
    'CA',
  );
});

test('placeDetailsJsonToFluxServiceArea includes regionCode', () => {
  const area = placeDetailsJsonToFluxServiceArea({
    id: 'places/ChIJtest',
    formattedAddress: 'Berlin, Germany',
    location: { latitude: 52.52, longitude: 13.405 },
    addressComponents: [{ types: ['country'], shortText: 'DE' }],
  });
  assert.ok(area);
  assert.equal(area.regionCode, 'DE');
});
