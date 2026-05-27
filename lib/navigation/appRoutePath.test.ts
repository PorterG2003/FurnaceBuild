import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppRoutePath } from './appRoutePath';

test('buildAppRoutePath string href', () => {
  assert.equal(buildAppRoutePath('/campaigns/abc'), '/campaigns/abc');
});

test('buildAppRoutePath pathname with params', () => {
  assert.equal(
    buildAppRoutePath({ pathname: '/inbox', params: { thread: 't-1' } }),
    '/inbox?thread=t-1',
  );
});
