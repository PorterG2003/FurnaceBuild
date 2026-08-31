import assert from 'node:assert/strict';
import test from 'node:test';
import { AE_TITLE_RE } from '../../config/sources.js';
import { countByTitle, detectOutboundMarketer, sequencerFromTech } from './gtm.js';

test('sequencer from Apollo tech uids', () => {
  assert.equal(sequencerFromTech(['salesloft']), true);
  assert.equal(sequencerFromTech(['hubspot']), false);
});

test('outbound marketer requires title plus corroboration', () => {
  const titleOnly = detectOutboundMarketer({
    people: [{ title: 'Demand Generation Manager', headline: 'Paid ads' }],
    sequencerDetected: false,
    jobPostingsText: '',
  });
  assert.deepEqual(titleOnly, { detected: false, title_only: true });

  const confirmed = detectOutboundMarketer({
    people: [{ title: 'Demand Generation Manager', headline: 'We run Instantly sequences' }],
    sequencerDetected: false,
    jobPostingsText: '',
  });
  assert.deepEqual(confirmed, { detected: true, title_only: false });

  const withStack = detectOutboundMarketer({
    people: [{ title: 'Growth Marketing Lead' }],
    sequencerDetected: true,
    jobPostingsText: '',
  });
  assert.deepEqual(withStack, { detected: true, title_only: false });

  const noTitle = detectOutboundMarketer({
    people: [{ title: 'Marketing Manager', headline: 'Runs Instantly all day' }],
    sequencerDetected: true,
    jobPostingsText: '',
  });
  assert.deepEqual(noTitle, { detected: false, title_only: false });
});

test('account manager is not an AE; account executive is', () => {
  assert.equal(countByTitle([{ title: 'Account Manager' }], AE_TITLE_RE), 0);
  assert.equal(countByTitle([{ title: 'Account Executive' }], AE_TITLE_RE), 1);
  assert.equal(countByTitle([{ title: 'Enterprise Account Director' }], AE_TITLE_RE), 1);
});
