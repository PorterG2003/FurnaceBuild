import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxFollowupFlow } from './flows/inbox-followup';
import { inboxFollowupMobileFlow } from './flows/inbox-followup-mobile';
import { TARGETS } from './types';

test('desktop follow-up never declares a modal host', () => {
  for (const step of inboxFollowupFlow.steps) {
    if (step.kind !== 'spotlight') continue;
    assert.equal(step.hostId, undefined, `${step.targetId} should render on the viewport, not a modal host`);
  }
});

const MOBILE_HOST_TARGETS = new Set([
  TARGETS.inboxActionClose,
  TARGETS.inboxActionBlock,
  TARGETS.inboxActionOutOfOffice,
  TARGETS.inboxActionReplace,
  TARGETS.inboxActionTags,
  TARGETS.inboxActionCategory,
]);

test('mobile follow-up scopes only the in-sheet row steps to the message actions host', () => {
  for (const step of inboxFollowupMobileFlow.steps) {
    if (step.kind !== 'spotlight') continue;
    if (MOBILE_HOST_TARGETS.has(step.targetId)) {
      assert.equal(step.hostId, 'inboxMessageActions', `${step.targetId} should render inside the sheet`);
    } else {
      assert.equal(step.hostId, undefined, `${step.targetId} should stay on the screen surface`);
    }
  }
});

test('lead detail and the sheet-open trigger stay on the global surface for both platforms', () => {
  const desktopLead = inboxFollowupFlow.steps.find(
    (step) => step.kind === 'spotlight' && step.targetId === TARGETS.inboxLeadDetail,
  );
  const mobileLead = inboxFollowupMobileFlow.steps.find(
    (step) => step.kind === 'spotlight' && step.targetId === TARGETS.inboxLeadDetail,
  );
  const mobileOpener = inboxFollowupMobileFlow.steps.find(
    (step) => step.kind === 'spotlight' && step.targetId === TARGETS.inboxMobileActions,
  );

  assert.ok(desktopLead?.kind === 'spotlight');
  assert.ok(mobileLead?.kind === 'spotlight');
  assert.ok(mobileOpener?.kind === 'spotlight');
  assert.equal(desktopLead?.kind === 'spotlight' ? desktopLead.hostId : undefined, undefined);
  assert.equal(mobileLead?.kind === 'spotlight' ? mobileLead.hostId : undefined, undefined);
  assert.equal(mobileOpener?.kind === 'spotlight' ? mobileOpener.hostId : undefined, undefined);
});

test('same TargetId (inboxActionClose) resolves to different surfaces across the two platform flows', () => {
  const desktopClose = inboxFollowupFlow.steps.find(
    (step) => step.kind === 'spotlight' && step.targetId === TARGETS.inboxActionClose,
  );
  const mobileClose = inboxFollowupMobileFlow.steps.find(
    (step) => step.kind === 'spotlight' && step.targetId === TARGETS.inboxActionClose,
  );
  assert.equal(desktopClose?.kind === 'spotlight' ? desktopClose.hostId : undefined, undefined);
  assert.equal(mobileClose?.kind === 'spotlight' ? mobileClose.hostId : undefined, 'inboxMessageActions');
});
