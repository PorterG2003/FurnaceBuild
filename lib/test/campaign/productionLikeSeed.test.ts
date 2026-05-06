import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductionLikeSeedSpecs,
  DEV_DEFAULT_CONVERSATION_COUNT,
  DEV_DEFAULT_MAILBOX_COUNT,
  DEV_DEFAULT_TOTAL_LEADS,
  getProductionLikeSeedSummary,
} from './productionLikeSeed';

test('production-like seed summary stays within the documented default shape', () => {
  const summary = getProductionLikeSeedSummary();

  assert.equal(summary.campaignCount, 5);
  assert.equal(summary.totalLeads, DEV_DEFAULT_TOTAL_LEADS);
  assert.equal(summary.totalThreads, DEV_DEFAULT_CONVERSATION_COUNT);
  assert.equal(summary.mailboxEmails.length, DEV_DEFAULT_MAILBOX_COUNT);
  assert.equal(summary.campaignIds.length, 5);
});

test('production-like seed allocates lead counts per campaign without drifting', () => {
  const specs = buildProductionLikeSeedSpecs();
  const counts = specs.map((spec) => spec.leads.length);
  assert.deepEqual(counts, [320, 280, 240, 200, 210]);
});

test('production-like seed keeps OOO and wait-node slices on the primary running campaign', () => {
  const specs = buildProductionLikeSeedSpecs();
  const primary = specs[0];
  assert.ok(primary);
  const oooDue = primary.leads.find((lead) => lead.key === 'primary-ooo-due');
  const oooFuture = primary.leads.find((lead) => lead.key === 'primary-ooo-future');

  assert.ok(oooDue?.thread?.outOfOffice);
  assert.equal(oooDue?.thread?.oooResumeRequested, true);
  assert.equal(oooDue?.enrollment?.state, 'stopped');
  assert.equal(oooDue?.enrollment?.currentFlowNodeId, 'waitTime-1');

  assert.ok(oooFuture?.thread?.outOfOffice);
  assert.equal(oooFuture?.thread?.oooResumeRequested, true);
  assert.equal(oooFuture?.enrollment?.currentFlowNodeId, 'waitTime-1');
});

test('production-like seed includes a replaced-lead pair on the primary running campaign with a completed replacement link', () => {
  const specs = buildProductionLikeSeedSpecs();
  const primary = specs[0];
  assert.ok(primary);

  const replacedOld = primary.leads.find((lead) => lead.key === 'primary-replaced-old');
  const replacedNew = primary.leads.find((lead) => lead.key === 'primary-replaced-new');
  assert.ok(replacedOld);
  assert.ok(replacedNew);

  assert.deepEqual(primary.replacements, [
    {
      oldKey: 'primary-replaced-old',
      newKey: 'primary-replaced-new',
      reason: 'manual_referral',
      reasonNote: 'Seeded replacement pair for QA.',
    },
  ]);

  assert.ok(specs.slice(1).every((spec) => !spec.replacements || spec.replacements.length === 0));
});
