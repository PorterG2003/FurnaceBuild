import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_FLOW_EXAMPLE_LINEAR } from '../campaigns/flow/examples.js';
import type { PrepareFlowSaveResult } from '../campaigns/flow/prepareFlowSave.js';
import {
  buildFlowDryRunResponse,
  buildFlowSaveResponse,
  prepareCampaignFlowForApi,
} from './campaign-flow.js';
import { ClientApiError } from './errors.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildPreparedResult(overrides: Partial<PrepareFlowSaveResult> = {}): PrepareFlowSaveResult {
  const flow = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  return {
    flow,
    validation: {
      issues: [],
      warnings: [],
      blockingIssues: [],
    },
    field_sync: {
      declared_custom_added: ['company'],
      declared_custom_removed: [],
      mapped_standard_added: [],
      mapped_standard_removed: [],
    },
    flow_revision: 'a'.repeat(64),
    changeKind: 'content',
    changeReasons: ['email copy changed'],
    lifecycle: { allowed: true },
    ...overrides,
  };
}

async function expectClientApiError(
  fn: () => Promise<unknown>,
  expected: { status: number; code: string; extensions?: { current_flow_revision?: string } },
): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(error instanceof ClientApiError);
    assert.equal(error.status, expected.status);
    assert.equal(error.payload.error.code, expected.code);
    if (expected.extensions?.current_flow_revision) {
      assert.equal(error.payload.current_flow_revision, expected.extensions.current_flow_revision);
    }
    return true;
  });
}

test('prepareCampaignFlowForApi maps FlowRevisionConflictError to flow_revision_conflict', async () => {
  const existing = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  await expectClientApiError(
    () => prepareCampaignFlowForApi({
      incomingFlow: existing,
      existingFlow: existing,
      campaignStatus: 'draft',
      ifMatch: 'deadbeef'.repeat(8),
    }),
    {
      status: 412,
      code: 'flow_revision_conflict',
    },
  );
});

test('prepareCampaignFlowForApi maps FlowEditForbiddenError to flow_locked', async () => {
  const existing = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  const structural = clone(CAMPAIGN_FLOW_EXAMPLE_LINEAR);
  structural.edges.pop();
  await expectClientApiError(
    () => prepareCampaignFlowForApi({
      incomingFlow: structural,
      existingFlow: existing,
      campaignStatus: 'running',
      phase: 'draft',
    }),
    { status: 403, code: 'flow_locked' },
  );
});

test('prepareCampaignFlowForApi maps FlowPrepareValidationError to invalid_flow with details', async () => {
  await expectClientApiError(
    () => prepareCampaignFlowForApi({
      incomingFlow: { nodes: [], edges: [] },
      existingFlow: { nodes: [], edges: [] },
      campaignStatus: 'draft',
    }),
    { status: 400, code: 'invalid_flow' },
  );
});

test('buildFlowSaveResponse includes documented save keys', () => {
  const prepared = buildPreparedResult();
  const response = buildFlowSaveResponse(prepared);
  assert.deepEqual(Object.keys(response).sort(), [
    'change_kind',
    'change_reasons',
    'field_sync',
    'flow',
    'flow_revision',
    'lifecycle',
    'validation',
  ]);
  assert.equal(response.flow_revision, prepared.flow_revision);
  assert.deepEqual(response.validation.blocking_issues, []);
});

test('buildFlowDryRunResponse includes documented dry-run keys', () => {
  const prepared = buildPreparedResult({
    validation: {
      issues: [{ path: 'nodes', code: 'missing', message: 'Missing node' }],
      warnings: [],
      blockingIssues: [{ path: 'nodes', code: 'missing', message: 'Missing node' }],
    },
  });
  const response = buildFlowDryRunResponse(prepared);
  assert.deepEqual(Object.keys(response).sort(), [
    'allowed',
    'blocking_issues',
    'change_kind',
    'change_reasons',
    'field_sync',
    'flow_revision',
    'issues',
    'lifecycle',
    'normalized_flow',
    'warnings',
  ]);
  assert.equal(response.allowed, false);
  assert.equal(response.blocking_issues.length, 1);
  assert.equal(response.normalized_flow.nodes.length, prepared.flow.nodes.length);
});
