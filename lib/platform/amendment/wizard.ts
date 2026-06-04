import { useMemo } from 'react';
import type { AgreementType } from '@/lib/platform/contract/terms';
import {
  parseInviteWizardPositiveWholeNumber,
  parseInviteWizardUsdInputToCents,
} from '@/lib/platform/invite/wizard';
import { clearWizardDraft, readWizardDraft, writeWizardDraft } from '@/lib/wizard/draftStorage';
import { useWizardNavigation } from '@/lib/wizard/navigation';

export type AmendmentWizardPath = 'terms_only' | 'plan_billing' | 'both';

export type AmendmentWizardStepId =
  | 'path'
  | 'proposal_billing'
  | 'terms'
  | 'review';

export type AmendmentWizardValidationInput = {
  agreementType: AgreementType;
  monthlyRetainer: string;
  managedOutreachVolume: string;
  managedInboxCount: string;
  termsSourceMarkdown: string;
};

export function buildAmendmentWizardStorageKey(accountId: string, amendmentId?: string | null) {
  return `furnace:amendment-wizard:${accountId}:${amendmentId ?? 'new'}`;
}

export function getAmendmentWizardSteps(path: AmendmentWizardPath): AmendmentWizardStepId[] {
  switch (path) {
    case 'terms_only':
      return ['path', 'terms', 'review'];
    case 'plan_billing':
      return ['path', 'proposal_billing', 'terms', 'review'];
    case 'both':
      return ['path', 'proposal_billing', 'terms', 'review'];
  }
}

export function getAmendmentWizardStepLabel(step: AmendmentWizardStepId): string {
  switch (step) {
    case 'path':
      return 'Choose changes';
    case 'proposal_billing':
      return 'Proposal & Billing';
    case 'terms':
      return 'Terms';
    case 'review':
      return 'Review';
  }
}

/** Maps pre-consolidation amendment indices (billing + proposal split) to the current flow. */
export function migrateLegacyAmendmentWizardStepIndex(
  path: AmendmentWizardPath,
  stepIndex: number,
): number {
  if (path === 'terms_only') {
    return stepIndex;
  }

  if (stepIndex <= 0) return 0;
  if (stepIndex <= 2) return 1;
  if (stepIndex === 3) return 2;
  if (stepIndex >= 4) return 3;
  return stepIndex;
}

export function clampAmendmentWizardStepIndex(path: AmendmentWizardPath, index: number): number {
  const migratedIndex = migrateLegacyAmendmentWizardStepIndex(path, index);
  const steps = getAmendmentWizardSteps(path);
  return Math.max(0, Math.min(migratedIndex, steps.length - 1));
}

export function validateAmendmentWizardStep(
  stepId: AmendmentWizardStepId,
  input: AmendmentWizardValidationInput,
): string | null {
  if (stepId === 'proposal_billing') {
    const monthlyRetainerCents = parseInviteWizardUsdInputToCents(input.monthlyRetainer);
    if (monthlyRetainerCents == null || monthlyRetainerCents < 0) {
      return 'Monthly retainer must be zero or greater.';
    }
    if (input.agreementType === 'managed_services_agreement') {
      if (parseInviteWizardPositiveWholeNumber(input.managedOutreachVolume) == null) {
        return 'Outreach volume is required for managed services.';
      }
      if (parseInviteWizardPositiveWholeNumber(input.managedInboxCount) == null) {
        return 'Inbox count is required for managed services.';
      }
    }
  }

  if (stepId === 'terms' && !input.termsSourceMarkdown.trim()) {
    return 'Agreement markdown is required.';
  }

  return null;
}

export function validateAmendmentWizardStepNavigation(params: {
  currentStepIndex: number;
  targetStepIndex: number;
  steps: AmendmentWizardStepId[];
  draft: AmendmentWizardValidationInput;
}): string | null {
  const { currentStepIndex, targetStepIndex, steps, draft } = params;
  const clampedTargetStepIndex = Math.max(0, Math.min(targetStepIndex, steps.length - 1));

  if (clampedTargetStepIndex <= currentStepIndex) {
    return null;
  }

  for (let index = currentStepIndex; index < clampedTargetStepIndex; index += 1) {
    const error = validateAmendmentWizardStep(steps[index] ?? 'path', draft);
    if (error) {
      return error;
    }
  }

  return null;
}

export function readAmendmentWizardDraft<T>(storageKey: string): T | null {
  return readWizardDraft<T>(storageKey);
}

export function writeAmendmentWizardDraft<T extends Record<string, unknown>>(
  storageKey: string,
  draft: T,
) {
  writeWizardDraft(storageKey, draft);
}

export function clearAmendmentWizardDraft(storageKey: string) {
  clearWizardDraft(storageKey);
}

export function useAmendmentWizardController(params: {
  path: AmendmentWizardPath;
  stepIndex: number;
  draft: AmendmentWizardValidationInput;
  setStepIndex: (updater: (current: number) => number) => void;
  onValidationError: (message: string) => void;
}) {
  const { path, stepIndex, draft, setStepIndex, onValidationError } = params;

  const steps = useMemo(() => getAmendmentWizardSteps(path), [path]);

  const { goBack, goNext, goToStep } = useWizardNavigation({
    stepIndex,
    stepCount: steps.length,
    setStepIndex,
    onValidationError,
    validateTransition: ({ currentStepIndex, targetStepIndex }) =>
      validateAmendmentWizardStepNavigation({
        currentStepIndex,
        targetStepIndex,
        steps,
        draft,
      }),
  });

  return {
    steps,
    goBack,
    goNext,
    goToStep,
  };
}
