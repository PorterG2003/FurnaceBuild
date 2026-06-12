import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInboxLoadingPolicy } from './inboxLoadingPolicy';

const base = {
  accountId: 'acct-1',
  initialThreadsLoadPending: false,
  isAccountTransitioning: false,
  switchingAccount: false,
  routeThreadId: null as string | null,
  selectedThreadId: null as string | null,
  routeAccessStatus: 'list_only' as const,
  threadsLoading: false,
  threadCount: 5,
  threadsError: null as string | null,
  messagesLoading: false,
  hasActiveFilters: false,
  refreshing: false,
};

test('computeInboxLoadingPolicy account transition shows immediate skeletons', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    isAccountTransitioning: true,
    threadsLoading: true,
    threadCount: 0,
  });
  assert.equal(policy.phase, 'accountTransition');
  assert.equal(policy.threadListSkeletonImmediate, true);
  assert.equal(policy.messagePaneSkeletonImmediate, true);
  assert.equal(policy.suppressEmptyStates, true);
  assert.equal(policy.keepPreviousThreadList, false);
});

test('computeInboxLoadingPolicy route resolving shows message pane skeleton', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    routeThreadId: 'thread-1',
    selectedThreadId: null,
    routeAccessStatus: 'loading',
  });
  assert.equal(policy.phase, 'routeResolving');
  assert.equal(policy.messagePaneSkeletonImmediate, true);
  assert.equal(policy.threadListSkeletonImmediate, false);
});

test('computeInboxLoadingPolicy thread click uses delayed message skeleton only', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    routeThreadId: 'thread-1',
    selectedThreadId: 'thread-1',
    routeAccessStatus: 'ready',
    messagesLoading: true,
  });
  assert.equal(policy.phase, 'messagesLoading');
  assert.equal(policy.threadListSkeletonImmediate, false);
  assert.equal(policy.threadListSkeletonDelayed, false);
  assert.equal(policy.messageBodySkeletonDelayed, true);
  assert.equal(policy.keepPreviousThreadList, false);
});

test('computeInboxLoadingPolicy filter reload keeps previous thread list', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    threadsLoading: true,
    threadCount: 5,
    hasActiveFilters: true,
  });
  assert.equal(policy.keepPreviousThreadList, true);
  assert.equal(policy.threadListSkeletonDelayed, false);
});

test('computeInboxLoadingPolicy empty list reload uses immediate thread skeleton', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    threadsLoading: true,
    threadCount: 0,
  });
  assert.equal(policy.phase, 'threadListLoading');
  assert.equal(policy.threadListSkeletonImmediate, true);
  assert.equal(policy.threadListSkeletonDelayed, false);
});

test('computeInboxLoadingPolicy background reload keeps previous thread list', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    threadsLoading: true,
    threadCount: 5,
  });
  assert.equal(policy.keepPreviousThreadList, true);
  assert.equal(policy.threadListSkeletonImmediate, false);
});

test('computeInboxLoadingPolicy pull-to-refresh keeps thread list visible', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    threadsLoading: true,
    threadCount: 3,
    refreshing: true,
  });
  assert.equal(policy.keepPreviousThreadList, true);
  assert.equal(policy.threadListSkeletonDelayed, false);
});

test('computeInboxLoadingPolicy initial cold load pending shows immediate skeleton', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    initialThreadsLoadPending: true,
    threadsLoading: true,
    threadCount: 0,
  });
  assert.equal(policy.threadListSkeletonImmediate, true);
  assert.equal(policy.suppressEmptyStates, true);
  assert.equal(policy.threadListSkeletonDelayed, false);
});

test('computeInboxLoadingPolicy cold thread URL pending shows message pane skeleton', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    initialThreadsLoadPending: true,
    routeThreadId: 'thread-1',
    routeAccessStatus: 'loading',
    threadsLoading: true,
    threadCount: 0,
  });
  assert.equal(policy.messagePaneSkeletonImmediate, true);
});

test('computeInboxLoadingPolicy ready with empty inbox after load', () => {
  const policy = computeInboxLoadingPolicy({
    ...base,
    threadsLoading: false,
    threadCount: 0,
  });
  assert.equal(policy.phase, 'ready');
  assert.equal(policy.suppressEmptyStates, false);
  assert.equal(policy.threadListSkeletonImmediate, false);
  assert.equal(policy.threadListSkeletonDelayed, false);
});
