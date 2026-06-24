import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppRoutePath } from './appRoutePath';

test('buildAppRoutePath string href', () => {
  assert.equal(buildAppRoutePath('/campaigns/abc'), '/campaigns/abc');
});

test('buildAppRoutePath pathname with params', () => {
  assert.equal(
    buildAppRoutePath({ pathname: '/inbox/[threadId]', params: { threadId: 't-1' } }),
    '/inbox/t-1',
  );
});

test('buildAppRoutePath pathname with path and query params', () => {
  assert.equal(
    buildAppRoutePath({
      pathname: '/campaigns/[id]/mission-control',
      params: { id: 'abc-123', tab: 'stats' },
    }),
    '/campaigns/abc-123/mission-control?tab=stats',
  );
});
