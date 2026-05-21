import assert from 'node:assert/strict';
import test from 'node:test';
import { fluxImageResizeMode } from './fluxImageFit.js';

test('fluxImageResizeMode falls back when fit is unset', () => {
  assert.equal(fluxImageResizeMode(undefined, 'cover'), 'cover');
});

test('fluxImageResizeMode returns explicit fit', () => {
  assert.equal(fluxImageResizeMode('contain', 'cover'), 'contain');
});
