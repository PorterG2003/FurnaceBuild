import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAILBOX_DAILY_LIMIT, sumUniqueMailboxDailyLimits } from './queueSendCapacity';

test('sumUniqueMailboxDailyLimits counts each mailbox once and defaults null limits to 50', () => {
  assert.equal(DEFAULT_MAILBOX_DAILY_LIMIT, 50);
  assert.deepEqual(
    sumUniqueMailboxDailyLimits([
      { id: 'a', daily_limit: 40 },
      { id: 'a', daily_limit: 40 },
      { id: 'b', daily_limit: null },
      { id: 'c', daily_limit: 10 },
    ]),
    { dailyEmails: 100, mailboxCount: 3 },
  );
});

test('sumUniqueMailboxDailyLimits is zero for an empty list', () => {
  assert.deepEqual(sumUniqueMailboxDailyLimits([]), { dailyEmails: 0, mailboxCount: 0 });
});
