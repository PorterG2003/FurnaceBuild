import { useMemo } from 'react';
import type { ProposalPlanTier } from '../contract/proposalPlans';
import type { AgreementType } from '../contract/terms';
import {
  clearWizardDraft,
  readWizardDraft,
  writeWizardDraft,
} from '@/lib/wizard/draftStorage';
import { useWizardNavigation } from '@/lib/wizard/navigation';

const PLATFORM_INVITE_WIZARD_STORAGE_PREFIX = 'platform-invite-wizard:';

export interface PlatformInviteWizardDraft {
  stepIndex: number;
  inviteEmail: string;
  inviteCompanyName: string;
  inviteMonthlyRetainer: string;
  planTier: ProposalPlanTier;
  proposalClientLogoUrl: string;
  proposalClientLogoScale: number;
  proposalClientLogoOffsetX: number;
  websiteTrafficSourcingEnabled: boolean;
  replyHandlingEnabled: boolean;
  agreementType: AgreementType;
  managedOutreachVolume: string;
  managedInboxCount: string;
  selectedTermsVersion: string;
  termsSourceMarkdown: string;
  autoAddInternalAdmins: boolean;
}

type InviteWizardValidationInput = Pick<
  PlatformInviteWizardDraft,
  | 'inviteEmail'
  | 'inviteMonthlyRetainer'
  | 'agreementType'
  | 'managedOutreachVolume'
  | 'managedInboxCount'
  | 'termsSourceMarkdown'
>;

function parseUsdInputToCents(value: string) {
  const normalized = value.trim().replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function parsePositiveWholeNumber(value: string) {
  const normalized = value.trim().replace(/[,\s]/g, '');
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export function getInviteWizardSteps(_agreementType?: AgreementType) {
  return ['Client', 'Proposal & Billing', 'Terms', 'Review', 'Approval'];
}

/** Maps pre-consolidation wizard indices (6 steps) to the current 5-step flow. */
export function migrateLegacyInviteWizardStepIndex(stepIndex: number): number {
  if (stepIndex <= 0) return 0;
  if (stepIndex <= 2) return 1;
  if (stepIndex === 3) return 2;
  if (stepIndex === 4) return 3;
  if (stepIndex >= 5) return 4;
  return stepIndex;
}

export function clampInviteWizardStepIndex(stepIndex: number, agreementType?: AgreementType) {
  const migrated = migrateLegacyInviteWizardStepIndex(stepIndex);
  const steps = getInviteWizardSteps(agreementType);
  return Math.max(0, Math.min(migrated, steps.length - 1));
}

export function validateInviteWizardStep(
  stepIndex: number,
  input: InviteWizardValidationInput,
): string | null {
  if (stepIndex === 0) {
    const email = input.inviteEmail.trim();
    if (!email) return 'Invite email is required.';
    if (!email.includes('@')) return 'Enter a valid invite email.';
  }

  if (stepIndex === 1) {
    const monthlyRetainerCents = parseUsdInputToCents(input.inviteMonthlyRetainer);
    if (monthlyRetainerCents == null || monthlyRetainerCents < 0) {
      return 'Monthly retainer must be zero or greater.';
    }
    if (input.agreementType === 'managed_services_agreement') {
      if (parsePositiveWholeNumber(input.managedOutreachVolume) == null) {
        return 'Outreach volume is required for managed services.';
      }
      if (parsePositiveWholeNumber(input.managedInboxCount) == null) {
        return 'Inbox count is required for managed services.';
      }
    }
  }

  if (stepIndex === 2 && !input.termsSourceMarkdown.trim()) {
    return 'Agreement markdown is required.';
  }

  return null;
}

export function validateInviteWizardStepNavigation(params: {
  currentStepIndex: number;
  targetStepIndex: number;
  agreementType: AgreementType;
  draft: InviteWizardValidationInput;
}): string | null {
  const { currentStepIndex, targetStepIndex, agreementType, draft } = params;
  const clampedTargetStepIndex = clampInviteWizardStepIndex(targetStepIndex, agreementType);

  if (clampedTargetStepIndex <= currentStepIndex) {
    return null;
  }

  for (let index = currentStepIndex; index < clampedTargetStepIndex; index += 1) {
    const error = validateInviteWizardStep(index, draft);
    if (error) {
      return error;
    }
  }

  return null;
}

export function buildPlatformInviteWizardStorageKey(invitationId?: string) {
  return `${PLATFORM_INVITE_WIZARD_STORAGE_PREFIX}${invitationId?.trim() || 'new'}`;
}

export function readPlatformInviteWizardDraft(storageKey: string): PlatformInviteWizardDraft | null {
  return readWizardDraft<PlatformInviteWizardDraft>(storageKey);
}

export function writePlatformInviteWizardDraft(storageKey: string, draft: PlatformInviteWizardDraft) {
  writeWizardDraft(storageKey, draft);
}

export function clearPlatformInviteWizardDraft(storageKey: string) {
  clearWizardDraft(storageKey);
}

export function useInviteWizardController(params: {
  agreementType: AgreementType;
  stepIndex: number;
  draft: InviteWizardValidationInput;
  setStepIndex: (updater: (current: number) => number) => void;
  onValidationError: (message: string) => void;
}) {
  const { agreementType, stepIndex, draft, setStepIndex, onValidationError } = params;

  const steps = useMemo(() => getInviteWizardSteps(agreementType), [agreementType]);
  const { goBack, goNext, goToStep } = useWizardNavigation({
    stepIndex,
    stepCount: steps.length,
    setStepIndex,
    onValidationError,
    validateTransition: ({ currentStepIndex, targetStepIndex }) =>
      validateInviteWizardStepNavigation({
        currentStepIndex,
        targetStepIndex,
        agreementType,
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

export function parseInviteWizardUsdInputToCents(value: string) {
  return parseUsdInputToCents(value);
}

export function parseInviteWizardPositiveWholeNumber(value: string) {
  return parsePositiveWholeNumber(value);
}
