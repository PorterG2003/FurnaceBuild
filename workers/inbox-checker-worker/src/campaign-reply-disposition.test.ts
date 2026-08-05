import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCampaignReplyDisposition,
  shouldAttemptCategorizerPark,
} from './campaign-reply-disposition.js';

const base = {
  isCampaignReply: true,
  isUnsubscribe: false,
  replyThreadIdAlreadySet: false,
  hasCategorizer: true,
  configError: false,
  parkStatus: null as string | null,
  parkError: false,
};

test('park held/woken/branched → park_ok', () => {
  for (const parkStatus of ['held', 'woken', 'branched'] as const) {
    assert.equal(
      resolveCampaignReplyDisposition({ ...base, parkStatus }),
      'park_ok',
      parkStatus,
    );
  }
});

test('unsubscribe → hard_stop even on categorizer campaign', () => {
  assert.equal(
    resolveCampaignReplyDisposition({ ...base, isUnsubscribe: true, parkStatus: 'held' }),
    'hard_stop',
  );
});

test('already branched (rtid set) → park_ok, never hard_stop', () => {
  assert.equal(
    resolveCampaignReplyDisposition({
      ...base,
      replyThreadIdAlreadySet: true,
      parkStatus: null,
      parkError: true,
    }),
    'park_ok',
  );
});

test('park RPC error on categorizer → leave_active_alert', () => {
  assert.equal(
    resolveCampaignReplyDisposition({ ...base, parkError: true }),
    'leave_active_alert',
  );
});

test('config error → leave_active_alert', () => {
  assert.equal(
    resolveCampaignReplyDisposition({
      ...base,
      hasCategorizer: false,
      configError: true,
      parkStatus: null,
    }),
    'leave_active_alert',
  );
});

test('park ineligible on categorizer → leave_active_alert', () => {
  assert.equal(
    resolveCampaignReplyDisposition({ ...base, parkStatus: 'ineligible' }),
    'leave_active_alert',
  );
});

test('confirmed non-categorizer → hard_stop', () => {
  assert.equal(
    resolveCampaignReplyDisposition({
      ...base,
      hasCategorizer: false,
      configError: false,
      parkStatus: null,
    }),
    'hard_stop',
  );
});

test('non-campaign reply → hard_stop', () => {
  assert.equal(
    resolveCampaignReplyDisposition({ ...base, isCampaignReply: false }),
    'hard_stop',
  );
});

test('shouldAttemptCategorizerPark: categorizer or config error, not unsub', () => {
  assert.equal(
    shouldAttemptCategorizerPark({
      isCampaignReply: true,
      hasEnrollmentId: true,
      isUnsubscribe: false,
      hasCategorizer: true,
      configError: false,
    }),
    true,
  );
  assert.equal(
    shouldAttemptCategorizerPark({
      isCampaignReply: true,
      hasEnrollmentId: true,
      isUnsubscribe: false,
      hasCategorizer: false,
      configError: true,
    }),
    true,
  );
  assert.equal(
    shouldAttemptCategorizerPark({
      isCampaignReply: true,
      hasEnrollmentId: true,
      isUnsubscribe: true,
      hasCategorizer: true,
      configError: false,
    }),
    false,
  );
  assert.equal(
    shouldAttemptCategorizerPark({
      isCampaignReply: true,
      hasEnrollmentId: true,
      isUnsubscribe: false,
      hasCategorizer: false,
      configError: false,
    }),
    false,
  );
});
