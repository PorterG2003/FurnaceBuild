import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllFlows, getFlow } from './index';

test('getFlow returns the same def for both segments when the registry entry is a single OnboardingFlowDef', () => {
  const selfServe = getFlow('welcome', 'self_serve');
  const dfy = getFlow('welcome', 'dfy');
  assert.ok(selfServe);
  assert.equal(selfServe, dfy);
});

test('the leads power tour is self-serve only (DFY never sees it)', () => {
  assert.ok(getFlow('leads', 'self_serve'), 'leads should exist for self_serve');
  assert.equal(getFlow('leads', 'dfy'), undefined, 'leads should not exist for dfy');
});

test('getAllFlows excludes the self-serve-only leads tour for dfy but includes it for self_serve', () => {
  const dfyFlows = getAllFlows('dfy').map((f) => f.id);
  const selfServeFlows = getAllFlows('self_serve').map((f) => f.id);

  assert.ok(!dfyFlows.includes('leads'), 'dfy flows should not include leads');
  assert.ok(selfServeFlows.includes('leads'), 'self_serve flows should include leads');
});

test('both platform-specific inbox tours are registered and shared across segments', () => {
  for (const id of ['inbox', 'inbox-mobile'] as const) {
    const selfServe = getFlow(id, 'self_serve');
    const dfy = getFlow(id, 'dfy');
    assert.ok(selfServe, `${id} should exist for self_serve`);
    assert.equal(selfServe, dfy, `${id} should be shared across segments`);
  }
});

test('the inbox tours are mutually mandatory-unless-seen so only the first completed one is locked', () => {
  const desktop = getFlow('inbox', 'self_serve');
  const mobile = getFlow('inbox-mobile', 'self_serve');
  assert.ok(desktop?.mandatory);
  assert.ok(mobile?.mandatory);
  assert.equal(desktop?.mandatoryUnlessSeen, 'inbox-mobile');
  assert.equal(mobile?.mandatoryUnlessSeen, 'inbox');
});
