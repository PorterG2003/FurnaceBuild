import assert from 'node:assert/strict';
import test from 'node:test';
import { DAVIS_PLACE_NAME, passesCorridorInclusion, placeInCounty } from '../../config/geography.js';

test('Salt Lake County any city', () => {
  assert.equal(passesCorridorInclusion({ lat: 40.76, fips: '49035', placeName: 'Emigration Canyon' }), true);
});

test('Utah County requires lat >= 39.99', () => {
  assert.equal(passesCorridorInclusion({ lat: 40.04, fips: '49049', placeName: 'Payson' }), true);
  assert.equal(passesCorridorInclusion({ lat: 39.97, fips: '49049', placeName: 'Santaquin' }), false);
});

test('Davis only North Salt Lake', () => {
  assert.equal(passesCorridorInclusion({ lat: 40.84, fips: '49011', placeName: DAVIS_PLACE_NAME }), true);
  assert.equal(passesCorridorInclusion({ lat: 40.89, fips: '49011', placeName: 'Bountiful' }), false);
});

test('placeInCounty matches Utah County cities', () => {
  assert.equal(placeInCounty('Lehi', 'utah'), true);
  assert.equal(placeInCounty('Salt Lake City', 'utah'), false);
  assert.equal(placeInCounty('Provo', 'utah'), true);
});
