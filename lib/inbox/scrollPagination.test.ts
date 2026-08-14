import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldLoadMoreThreadsOnScroll,
  shouldLoadOlderMessagesOnScroll,
} from './scrollPagination';

test('shouldLoadOlderMessagesOnScroll fires near top when more history exists', () => {
  assert.equal(
    shouldLoadOlderMessagesOnScroll({ offsetY: 0, hasOlder: true, loading: false }),
    true,
  );
  assert.equal(
    shouldLoadOlderMessagesOnScroll({ offsetY: 120, hasOlder: true, loading: false }),
    true,
  );
  assert.equal(
    shouldLoadOlderMessagesOnScroll({ offsetY: 121, hasOlder: true, loading: false }),
    false,
  );
});

test('shouldLoadOlderMessagesOnScroll respects loading and hasOlder guards', () => {
  assert.equal(
    shouldLoadOlderMessagesOnScroll({ offsetY: 0, hasOlder: false, loading: false }),
    false,
  );
  assert.equal(
    shouldLoadOlderMessagesOnScroll({ offsetY: 0, hasOlder: true, loading: true }),
    false,
  );
});

test('shouldLoadMoreThreadsOnScroll fires near bottom when more pages exist', () => {
  assert.equal(
    shouldLoadMoreThreadsOnScroll({
      offsetY: 840,
      viewportHeight: 500,
      contentHeight: 1500,
      hasMore: true,
      loading: false,
    }),
    true,
  );
  assert.equal(
    shouldLoadMoreThreadsOnScroll({
      offsetY: 800,
      viewportHeight: 500,
      contentHeight: 1500,
      hasMore: true,
      loading: false,
    }),
    false,
  );
});

test('shouldLoadMoreThreadsOnScroll respects loading and hasMore guards', () => {
  assert.equal(
    shouldLoadMoreThreadsOnScroll({
      offsetY: 1000,
      viewportHeight: 500,
      contentHeight: 1500,
      hasMore: false,
      loading: false,
    }),
    false,
  );
  assert.equal(
    shouldLoadMoreThreadsOnScroll({
      offsetY: 1000,
      viewportHeight: 500,
      contentHeight: 1500,
      hasMore: true,
      loading: true,
    }),
    false,
  );
});
