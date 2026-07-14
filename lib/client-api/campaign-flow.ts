import {
  FlowEditForbiddenError,
  FlowPrepareValidationError,
  FlowRevisionConflictError,
  prepareFlowSave,
  type PrepareFlowSaveInput,
  type PrepareFlowSaveResult,
} from '../campaigns/flow/index.js';
import {
  flowRevisionConflict,
  forbidden,
  invalidRequestWithDetails,
} from './errors.js';

export async function prepareCampaignFlowForApi(input: PrepareFlowSaveInput): Promise<PrepareFlowSaveResult> {
  try {
    return await prepareFlowSave(input);
  } catch (error) {
    if (error instanceof FlowRevisionConflictError) {
      flowRevisionConflict(error.currentFlowRevision);
    }
    if (error instanceof FlowEditForbiddenError) {
      forbidden(error.code, error.message);
    }
    if (error instanceof FlowPrepareValidationError) {
      invalidRequestWithDetails(error.code, error.message, error.issues);
    }
    throw error;
  }
}

export function buildFlowSaveResponse(
  prepared: PrepareFlowSaveResult,
  reactivatedCount = 0,
) {
  return {
    flow: prepared.flow,
    field_sync: prepared.field_sync,
    flow_revision: prepared.flow_revision,
    change_kind: prepared.changeKind,
    change_reasons: prepared.changeReasons,
    reactivated_count: reactivatedCount,
    validation: {
      issues: prepared.validation.issues,
      warnings: prepared.validation.warnings,
      blocking_issues: prepared.validation.blockingIssues,
    },
    lifecycle: prepared.lifecycle,
  };
}

export function buildFlowDryRunResponse(prepared: PrepareFlowSaveResult) {
  return {
    normalized_flow: prepared.flow,
    field_sync: prepared.field_sync,
    flow_revision: prepared.flow_revision,
    allowed: prepared.lifecycle.allowed && prepared.validation.blockingIssues.length === 0,
    change_kind: prepared.changeKind,
    change_reasons: prepared.changeReasons,
    lifecycle: prepared.lifecycle,
    issues: prepared.validation.issues,
    warnings: prepared.validation.warnings,
    blocking_issues: prepared.validation.blockingIssues,
  };
}
