import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInboxInternalThreadHref,
  buildInboxListHref,
  buildInboxThreadHref,
  buildInboxThreadPath,
  canUseInternalInboxRouteAccess,
  isInboxPath,
  parseInboxNotificationUrl,
  parseInboxThreadIdFromPathname,
  parseLegacyInboxSearchParams,
  resolveInboxRouteAccess,
  shouldAllowInboxAccountSwitch,
} from './inboxRoutes';

test('buildInboxThreadPath is path only', () => {
  assert.equal(buildInboxThreadPath('t-1'), '/inbox/t-1');
  assert.doesNotMatch(buildInboxThreadPath('t-1'), /\?/);
});

test('buildInboxInternalThreadHref has no query string', () => {
  assert.equal(buildInboxInternalThreadHref('t-1'), '/inbox/t-1');
  assert.doesNotMatch(String(buildInboxInternalThreadHref('t-1')), /\?/);
});

test('shouldAllowInboxAccountSwitch on route change', () => {
  assert.equal(shouldAllowInboxAccountSwitch({ routeThreadChanged: true }), true);
});

test('shouldAllowInboxAccountSwitch rejects manual switch stale URL', () => {
  assert.equal(shouldAllowInboxAccountSwitch({ routeThreadChanged: false }), false);
});

test('buildInboxListHref', () => {
  assert.equal(buildInboxListHref(), '/inbox');
});

test('buildInboxThreadHref uses path string not query threadId param', () => {
  assert.equal(buildInboxThreadHref('t-1'), '/inbox/t-1');
  assert.doesNotMatch(String(buildInboxThreadHref('t-1')), /threadId=/);
});

test('parseLegacyInboxSearchParams', () => {
  assert.deepEqual(parseLegacyInboxSearchParams('?thread=t-1&accountId=a-1'), {
    threadId: 't-1',
    accountId: 'a-1',
  });
  assert.equal(parseLegacyInboxSearchParams(''), null);
  assert.equal(parseLegacyInboxSearchParams('?foo=bar'), null);
});

test('parseInboxNotificationUrl path-based', () => {
  assert.deepEqual(parseInboxNotificationUrl('/inbox/thread-1'), {
    threadId: 'thread-1',
    accountId: null,
  });
});

test('parseInboxNotificationUrl legacy accountId query', () => {
  assert.deepEqual(parseInboxNotificationUrl('/inbox/thread-1?accountId=acct-1'), {
    threadId: 'thread-1',
    accountId: 'acct-1',
  });
});

test('parseInboxNotificationUrl legacy query', () => {
  assert.deepEqual(parseInboxNotificationUrl('/inbox?thread=thread-1&accountId=acct-1'), {
    threadId: 'thread-1',
    accountId: 'acct-1',
  });
});

test('parseInboxNotificationUrl ignores replace-lead path', () => {
  assert.equal(parseInboxNotificationUrl('/inbox/replace-lead?thread=t-1'), null);
});

test('parseInboxNotificationUrl ignores non-inbox', () => {
  assert.equal(parseInboxNotificationUrl('/campaigns/abc'), null);
});

test('isInboxPath', () => {
  assert.equal(isInboxPath('/inbox'), true);
  assert.equal(isInboxPath('/inbox/abc'), true);
  assert.equal(isInboxPath('/inbox/replace-lead'), true);
  assert.equal(isInboxPath('/campaigns'), false);
  assert.equal(isInboxPath(null), false);
});

test('resolveInboxRouteAccess list only', () => {
  assert.deepEqual(
    resolveInboxRouteAccess({
      routeThreadId: null,
      currentAccountId: 'a-1',
      membershipAccountIds: ['a-1'],
      threadAccountId: null,
      threadExists: false,
    }),
    { status: 'list_only', targetAccountId: 'a-1' },
  );
});

test('resolveInboxRouteAccess ready', () => {
  assert.deepEqual(
    resolveInboxRouteAccess({
      routeThreadId: 't-1',
      currentAccountId: 'a-2',
      membershipAccountIds: ['a-1', 'a-2'],
      threadAccountId: 'a-1',
      threadExists: true,
    }),
    { status: 'ready', targetAccountId: 'a-1' },
  );
});

test('resolveInboxRouteAccess not member', () => {
  assert.deepEqual(
    resolveInboxRouteAccess({
      routeThreadId: 't-1',
      currentAccountId: 'a-1',
      membershipAccountIds: ['a-1'],
      threadAccountId: 'a-other',
      threadExists: true,
    }),
    { status: 'denied', targetAccountId: 'a-other', reason: 'not_member' },
  );
});

test('resolveInboxRouteAccess thread not found', () => {
  assert.deepEqual(
    resolveInboxRouteAccess({
      routeThreadId: 't-1',
      currentAccountId: 'a-1',
      membershipAccountIds: ['a-1'],
      threadAccountId: null,
      threadExists: false,
    }),
    { status: 'denied', targetAccountId: 'a-1', reason: 'thread_not_found' },
  );
});

test('parseInboxThreadIdFromPathname list', () => {
  assert.equal(parseInboxThreadIdFromPathname('/inbox'), null);
});

test('parseInboxThreadIdFromPathname thread', () => {
  assert.equal(parseInboxThreadIdFromPathname('/inbox/abc-123'), 'abc-123');
});

test('parseInboxThreadIdFromPathname replace-lead', () => {
  assert.equal(parseInboxThreadIdFromPathname('/inbox/replace-lead'), null);
});

test('parseInboxThreadIdFromPathname non-inbox', () => {
  assert.equal(parseInboxThreadIdFromPathname('/campaigns/abc'), null);
  assert.equal(parseInboxThreadIdFromPathname(null), null);
});

test('parseInboxThreadIdFromPathname encoded segment', () => {
  assert.equal(parseInboxThreadIdFromPathname('/inbox/thread%2Fid'), 'thread/id');
});

test('canUseInternalInboxRouteAccess fast path when thread in list', () => {
  assert.equal(
    canUseInternalInboxRouteAccess({
      routeThreadId: 't-1',
      loadedThreadIds: ['t-1', 't-2'],
      loadedForAccountId: 'a-1',
      currentAccountId: 'a-1',
    }),
    true,
  );
});

test('canUseInternalInboxRouteAccess rejects stale loaded account', () => {
  assert.equal(
    canUseInternalInboxRouteAccess({
      routeThreadId: 't-1',
      loadedThreadIds: ['t-1'],
      loadedForAccountId: 'a-old',
      currentAccountId: 'a-new',
    }),
    false,
  );
});

test('canUseInternalInboxRouteAccess rejects thread not in list', () => {
  assert.equal(
    canUseInternalInboxRouteAccess({
      routeThreadId: 't-99',
      loadedThreadIds: ['t-1'],
      loadedForAccountId: 'a-1',
      currentAccountId: 'a-1',
    }),
    false,
  );
});
