/**
 * Flow mutation contract (client + API):
 * 1. prepareFlowSave — normalize (incl. orphan-edge prune), syncFields, classify, lifecycle, validate, revision
 * 2. SQL assert_flow_edit_allowed — authoritative stopped / running-structural policy
 * 3. SQL reactivate_completed_enrollments_on_non_leaves — enrollment side effect on write
 *
 * Do not add a parallel heal/classifier outside these layers.
 */
import { classifyFlowChange } from './diff.js';
import { assertFlowEditAllowed } from './lifecycle.js';
import { normalizeFlowData } from './normalize.js';
import {
  assertFlowRevision,
  computeFlowRevision,
  FlowRevisionConflictError,
} from './revision.js';
import { syncFields, type FieldSyncResult } from './syncFields.js';
import type {
  CampaignFlowData,
  CampaignStatus,
  FlowChangeKind,
  FlowValidationIssue,
} from './types';
import { validateForPhase, type FlowValidationPhase, type PhaseValidationResult } from './validate.js';

export { FlowRevisionConflictError } from './revision.js';

export class FlowPrepareValidationError extends Error {
  readonly code = 'invalid_flow' as const;
  readonly issues: FlowValidationIssue[];

  constructor(issues: FlowValidationIssue[], message = 'Flow validation failed') {
    super(message);
    this.name = 'FlowPrepareValidationError';
    this.issues = issues;
  }
}

export class FlowEditForbiddenError extends Error {
  readonly code: 'flow_locked';
  readonly message: string;

  constructor(code: 'flow_locked', message: string) {
    super(message);
    this.name = 'FlowEditForbiddenError';
    this.code = code;
    this.message = message;
  }
}

export type PrepareFlowSaveInput = {
  incomingFlow: unknown;
  existingFlow?: unknown;
  campaignStatus?: CampaignStatus | null;
  phase?: FlowValidationPhase;
  ifMatch?: string | null;
};

export type PrepareFlowSaveResult = {
  flow: CampaignFlowData;
  validation: PhaseValidationResult;
  field_sync: FieldSyncResult;
  flow_revision: string;
  changeKind: FlowChangeKind;
  changeReasons: string[];
  lifecycle: ReturnType<typeof assertFlowEditAllowed>;
};

export async function prepareFlowSave(input: PrepareFlowSaveInput): Promise<PrepareFlowSaveResult> {
  const phase = input.phase ?? 'draft';
  const existingNormalized = normalizeFlowData(input.existingFlow ?? { nodes: [], edges: [] });
  const currentRevision = await computeFlowRevision(existingNormalized);

  assertFlowRevision(input.ifMatch, currentRevision);

  const normalized = normalizeFlowData(input.incomingFlow ?? { nodes: [], edges: [] });
  const { flow: syncedFlow, field_sync } = syncFields(normalized);
  const change = classifyFlowChange(existingNormalized, syncedFlow);
  const lifecycle = assertFlowEditAllowed(input.campaignStatus ?? null, change.kind);

  if (!lifecycle.allowed) {
    throw new FlowEditForbiddenError(
      lifecycle.code ?? 'flow_locked',
      lifecycle.message ?? 'Flow edit is not allowed',
    );
  }

  const validation = validateForPhase(syncedFlow, phase);
  if (validation.blockingIssues.length > 0) {
    throw new FlowPrepareValidationError(validation.blockingIssues);
  }

  const flow_revision = await computeFlowRevision(syncedFlow);

  return {
    flow: syncedFlow,
    validation,
    field_sync,
    flow_revision,
    changeKind: change.kind,
    changeReasons: change.reasons,
    lifecycle,
  };
}

export async function prepareFlowDryRun(input: PrepareFlowSaveInput): Promise<PrepareFlowSaveResult> {
  return prepareFlowSave(input);
}
