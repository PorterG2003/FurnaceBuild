import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllFlows, getFlow } from './index';

test('getFlow returns the same def for both segments when the registry entry is a single OnboardingFlowDef', () => {
  const selfServe = getFlow('welcome', 'self_serve');
  const dfy = getFlow('welcome', 'dfy');
  assert.ok(selfServe);
  assert.equal(selfServe, dfy);
});

test('getAllFlows returns the same live flow ids for both segments', () => {
  const expected = [
    'welcome',
    'inbox',
    'inbox-mobile',
    'inbox-followup',
    'inbox-followup-mobile',
    'account',
  ];

  assert.deepEqual(getAllFlows('self_serve').map((flow) => flow.id), expected);
  assert.deepEqual(getAllFlows('dfy').map((flow) => flow.id), expected);
});

test('both platform-specific inbox tours are registered and shared across segments', () => {
  for (const id of ['inbox', 'inbox-mobile', 'inbox-followup', 'inbox-followup-mobile'] as const) {
    const selfServe = getFlow(id, 'self_serve');
    const dfy = getFlow(id, 'dfy');
    assert.ok(selfServe, `${id} should exist for self_serve`);
    assert.equal(selfServe, dfy, `${id} should be shared across segments`);
  }
});

test('the inbox basics tours are mutually mandatory-unless-seen so only the first completed one is locked', () => {
  const desktop = getFlow('inbox', 'self_serve');
  const mobile = getFlow('inbox-mobile', 'self_serve');
  assert.ok(desktop?.mandatory);
  assert.ok(mobile?.mandatory);
  assert.equal(desktop?.mandatoryUnlessSeen, 'inbox-mobile');
  assert.equal(mobile?.mandatoryUnlessSeen, 'inbox');
});

test('the inbox follow-up topic flows stay optional', () => {
  for (const id of ['inbox-followup', 'inbox-followup-mobile'] as const) {
    const flow = getFlow(id, 'self_serve');
    assert.equal(flow?.mandatory, undefined, `${id} should be optional`);
    assert.equal(flow?.mandatoryUnlessSeen, undefined, `${id} should not use mandatoryUnlessSeen`);
  }
});

test('inbox flows stay grouped in topic order ahead of later product tours', () => {
  const selfServeFlows = getAllFlows('self_serve').map((flow) => flow.id);
  const inboxFlows = selfServeFlows.filter((id) => id.startsWith('inbox'));
  assert.deepEqual(inboxFlows, [
    'inbox',
    'inbox-mobile',
    'inbox-followup',
    'inbox-followup-mobile',
  ]);
});
