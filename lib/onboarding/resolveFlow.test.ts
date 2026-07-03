import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCopy, resolveFlow } from './resolveFlow';
import type { OnboardingFlowDef } from './types';

test('resolveCopy returns a plain string unchanged', () => {
  assert.equal(resolveCopy('hello', 'dfy'), 'hello');
  assert.equal(resolveCopy('hello', 'self_serve'), 'hello');
});

test('resolveCopy picks the segment value, falling back to default', () => {
  const copy = { default: 'shared', dfy: 'for dfy' } as const;
  assert.equal(resolveCopy(copy, 'dfy'), 'for dfy');
  assert.equal(resolveCopy(copy, 'self_serve'), 'shared');
});

const def: OnboardingFlowDef = {
  id: 'account',
  version: 2,
  steps: [
    {
      kind: 'announcement',
      title: { default: 'Hi', dfy: 'Hello DFY' },
      render: () => null,
    },
    {
      kind: 'spotlight',
      targetId: 'accountTeam',
      title: 'Manage your team',
      body: 'b',
      requiresRole: ['owner', 'admin'],
    },
    {
      kind: 'spotlight',
      targetId: 'accountNotifications',
      title: { default: 'Notifications', dfy: 'Replies' },
      body: 'Stay on top of replies',
    },
  ],
};

test('resolveFlow carries id/version and resolves segment copy', () => {
  const flow = resolveFlow(def, { segment: 'dfy', role: 'owner' });
  assert.equal(flow.id, 'account');
  assert.equal(flow.version, 2);
  const announcement = flow.steps[0];
  assert.equal(announcement.kind, 'announcement');
  if (announcement.kind === 'announcement') {
    assert.equal(announcement.title, 'Hello DFY');
  }
});

test('resolveFlow keeps role-gated steps for matching roles', () => {
  const flow = resolveFlow(def, { segment: 'self_serve', role: 'admin' });
  assert.equal(flow.steps.length, 3);
});

test('resolveFlow drops role-gated steps for non-matching roles', () => {
  const flow = resolveFlow(def, { segment: 'self_serve', role: 'member' });
  assert.equal(flow.steps.length, 2);
  const hasTeamStep = flow.steps.some(
    (step) => step.kind === 'spotlight' && step.targetId === 'accountTeam',
  );
  assert.equal(hasTeamStep, false);
});

test('resolveFlow falls back to default copy when the segment is missing', () => {
  const flow = resolveFlow(def, { segment: 'self_serve', role: 'member' });
  const spotlight = flow.steps.find((step) => step.kind === 'spotlight');
  assert.equal(spotlight?.kind, 'spotlight');
  if (spotlight?.kind === 'spotlight') {
    assert.equal(spotlight.title, 'Notifications');
  }
});

test('resolveFlow yields an empty (trivially complete) flow when all steps filter out', () => {
  const ownerOnly: OnboardingFlowDef = {
    id: 'account',
    version: 1,
    steps: [
      { kind: 'spotlight', targetId: 'accountTeam', title: 't', body: 'b', requiresRole: ['owner'] },
    ],
  };
  const flow = resolveFlow(ownerOnly, { segment: 'self_serve', role: 'member' });
  assert.equal(flow.steps.length, 0);
});
