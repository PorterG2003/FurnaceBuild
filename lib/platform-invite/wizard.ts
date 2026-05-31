import { useCallback, useMemo } from 'react';
import type { ProposalPlanTier } from './proposalPlans';
import type { AgreementType } from './terms';

const PLATFORM_INVITE_WIZARD_STORAGE_PREFIX = 'platform-invite-wizard:';

export interface PlatformInviteWizardDraft {
  stepIndex: number;
  inviteEmail: string;
  inviteCompanyName: string;
  inviteMonthlyRetainer: string;
  inviteFirstMonthDiscount: string;
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
  | 'inviteFirstMonthDiscount'
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

export function getInviteWizardSteps(agreementType: AgreementType) {
  return [
    'Client',
    'Billing',
    agreementType === 'managed_services_agreement' ? 'Proposal' : 'Access',
    'Terms',
    'Review',
    'Approval',
  ];
}

export function clampInviteWizardStepIndex(stepIndex: number, agreementType: AgreementType) {
  const steps = getInviteWizardSteps(agreementType);
  return Math.max(0, Math.min(stepIndex, steps.length - 1));
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
    const firstMonthDiscountCents = parseUsdInputToCents(input.inviteFirstMonthDiscount) ?? 0;
    if (monthlyRetainerCents == null || monthlyRetainerCents <= 0) {
      return 'Monthly retainer must be greater than zero.';
    }
    if (firstMonthDiscountCents < 0) {
      return 'First month discount cannot be negative.';
    }
  }

  if (stepIndex === 2 && input.agreementType === 'managed_services_agreement') {
    if (parsePositiveWholeNumber(input.managedOutreachVolume) == null) {
      return 'Outreach volume is required for managed services.';
    }
    if (parsePositiveWholeNumber(input.managedInboxCount) == null) {
      return 'Inbox count is required for managed services.';
    }
  }

  if (stepIndex === 3 && !input.termsSourceMarkdown.trim()) {
    return 'Agreement markdown is required.';
  }

  return null;
}

export function buildPlatformInviteWizardStorageKey(invitationId?: string) {
  return `${PLATFORM_INVITE_WIZARD_STORAGE_PREFIX}${invitationId?.trim() || 'new'}`;
}

export function readPlatformInviteWizardDraft(storageKey: string): PlatformInviteWizardDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { data?: PlatformInviteWizardDraft };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

export function writePlatformInviteWizardDraft(storageKey: string, draft: PlatformInviteWizardDraft) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      savedAt: Date.now(),
      data: draft,
    }),
  );
}

export function clearPlatformInviteWizardDraft(storageKey: string) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(storageKey);
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

  const goBack = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0));
  }, [setStepIndex]);

  const goNext = useCallback(() => {
    const error = validateInviteWizardStep(stepIndex, draft);
    if (error) {
      onValidationError(error);
      return false;
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
    return true;
  }, [draft, onValidationError, setStepIndex, stepIndex, steps.length]);

  return {
    steps,
    goBack,
    goNext,
  };
}

export function parseInviteWizardUsdInputToCents(value: string) {
  return parseUsdInputToCents(value);
}

export function parseInviteWizardPositiveWholeNumber(value: string) {
  return parsePositiveWholeNumber(value);
}
