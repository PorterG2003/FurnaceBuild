import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInboxToolbarFlow, isInboxToolbarFlowId } from './inbox-toolbar';
import { inboxFollowupFlow } from './inbox-followup';
import { inboxFollowupMobileFlow } from './inbox-followup-mobile';
import { TARGETS, type OnboardingFlowDef } from '../types';

const def: OnboardingFlowDef = {
  id: 'inbox-followup',
  version: 2,
  steps: [
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxLeadDetail,
      title: 'lead',
      body: 'b',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxThreadActions,
      title: 'intro',
      body: 'b',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionClose,
      title: 'close',
      body: 'b',
      advance: 'manual',
      toolbarActionKey: 'close',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionBlock,
      title: 'block',
      body: 'b',
      advance: 'manual',
      toolbarActionKey: 'block',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionOutOfOffice,
      title: 'ooo',
      body: 'b',
      advance: 'manual',
      toolbarActionKey: 'ooo',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionReplace,
      title: 'replace',
      body: 'b',
      advance: 'manual',
      toolbarActionKey: 'replace',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionTags,
      title: 'tags',
      body: 'b',
      advance: 'manual',
      toolbarActionKey: 'tags',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionCategory,
      title: 'category',
      body: 'b',
      advance: 'manual',
    },
  ],
};

function targetIds(flow: OnboardingFlowDef): string[] {
  return flow.steps.map((step) => (step.kind === 'spotlight' ? step.targetId : 'announcement'));
}

test('isInboxToolbarFlowId only matches the desktop toolbar tours', () => {
  assert.equal(isInboxToolbarFlowId('inbox-followup'), true);
  assert.equal(isInboxToolbarFlowId('inbox-followup-mobile'), false);
  assert.equal(isInboxToolbarFlowId('inbox'), false);
  assert.equal(isInboxToolbarFlowId('welcome'), false);
});

test('all actions inline preserves desktop left-to-right order', () => {
  const flow = buildInboxToolbarFlow(def, []);
  assert.deepEqual(targetIds(flow), [
    TARGETS.inboxLeadDetail,
    TARGETS.inboxThreadActions,
    TARGETS.inboxActionClose,
    TARGETS.inboxActionBlock,
    TARGETS.inboxActionOutOfOffice,
    TARGETS.inboxActionReplace,
    TARGETS.inboxActionTags,
    TARGETS.inboxActionCategory,
  ]);
});

test('null overflow (unknown split) is treated as all inline', () => {
  const flow = buildInboxToolbarFlow(def, null);
  assert.deepEqual(targetIds(flow), [
    TARGETS.inboxLeadDetail,
    TARGETS.inboxThreadActions,
    TARGETS.inboxActionClose,
    TARGETS.inboxActionBlock,
    TARGETS.inboxActionOutOfOffice,
    TARGETS.inboxActionReplace,
    TARGETS.inboxActionTags,
    TARGETS.inboxActionCategory,
  ]);
});

test('all actions overflowed inserts one opener then walks the menu top-to-bottom', () => {
  const flow = buildInboxToolbarFlow(def, ['close', 'block', 'ooo', 'replace', 'tags']);
  assert.deepEqual(targetIds(flow), [
    TARGETS.inboxLeadDetail,
    TARGETS.inboxThreadActions,
    TARGETS.inboxActionCloseOverflowTrigger,
    TARGETS.inboxActionClose,
    TARGETS.inboxActionBlock,
    TARGETS.inboxActionOutOfOffice,
    TARGETS.inboxActionReplace,
    TARGETS.inboxActionTags,
    TARGETS.inboxActionCategory,
  ]);
  const openers = flow.steps.filter((step) => step.kind === 'spotlight' && step.targetId.endsWith('OverflowTrigger'));
  assert.equal(openers.length, 1);
});

test('mixed split keeps inline actions left-to-right, then opener, then overflow actions top-to-bottom', () => {
  const flow = buildInboxToolbarFlow(def, ['replace', 'tags']);
  assert.deepEqual(targetIds(flow), [
    TARGETS.inboxLeadDetail,
    TARGETS.inboxThreadActions,
    TARGETS.inboxActionClose,
    TARGETS.inboxActionBlock,
    TARGETS.inboxActionOutOfOffice,
    TARGETS.inboxActionReplaceOverflowTrigger,
    TARGETS.inboxActionReplace,
    TARGETS.inboxActionTags,
    TARGETS.inboxActionCategory,
  ]);
});

test('desktop authored follow-up keeps category after toolbar-backed actions', () => {
  assert.deepEqual(
    inboxFollowupFlow.steps.map((step) => (step.kind === 'spotlight' ? step.targetId : 'announcement')),
    [
      TARGETS.inboxLeadDetail,
      TARGETS.inboxThreadActions,
      TARGETS.inboxActionClose,
      TARGETS.inboxActionBlock,
      TARGETS.inboxActionOutOfOffice,
      TARGETS.inboxActionReplace,
      TARGETS.inboxActionTags,
      TARGETS.inboxActionCategory,
    ],
  );
});

test('mobile authored follow-up matches the sheet top-to-bottom order', () => {
  assert.deepEqual(
    inboxFollowupMobileFlow.steps.map((step) => (step.kind === 'spotlight' ? step.targetId : 'announcement')),
    [
      TARGETS.inboxLeadDetail,
      TARGETS.inboxMobileActions,
      TARGETS.inboxActionClose,
      TARGETS.inboxActionBlock,
      TARGETS.inboxActionOutOfOffice,
      TARGETS.inboxActionReplace,
      TARGETS.inboxActionTags,
      TARGETS.inboxActionCategory,
    ],
  );
});

test('build preserves flow id and version', () => {
  const flow = buildInboxToolbarFlow(def, ['close', 'tags']);
  assert.equal(flow.id, 'inbox-followup');
  assert.equal(flow.version, 2);
});
