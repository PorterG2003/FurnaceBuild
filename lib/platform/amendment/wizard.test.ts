import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAmendmentWizardStorageKey,
  clearAmendmentWizardDraft,
  clampAmendmentWizardStepIndex,
  getAmendmentWizardStepLabel,
  getAmendmentWizardSteps,
  migrateLegacyAmendmentWizardStepIndex,
  readAmendmentWizardDraft,
  validateAmendmentWizardStep,
  validateAmendmentWizardStepNavigation,
  writeAmendmentWizardDraft,
  type AmendmentWizardValidationInput,
} from './wizard';

function withMockLocalStorage(fn: () => void) {
  const storage = new Map<string, string>();
  const previousWindow = (globalThis as { window?: unknown }).window;

  (globalThis as { window?: { localStorage: Storage } }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage,
  };

  try {
    fn();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
}

function buildDraft(
  overrides: Partial<AmendmentWizardValidationInput> = {},
): AmendmentWizardValidationInput {
  return {
    agreementType: 'managed_services_agreement',
    monthlyRetainer: '3000',
    managedOutreachVolume: '5000',
    managedInboxCount: '25',
    termsSourceMarkdown: '# Terms',
    ...overrides,
  };
}

test('getAmendmentWizardSteps consolidates proposal and billing for plan changes', () => {
  assert.deepEqual(getAmendmentWizardSteps('plan_billing'), [
    'path',
    'proposal_billing',
    'terms',
    'review',
  ]);
  assert.deepEqual(getAmendmentWizardSteps('both'), [
    'path',
    'proposal_billing',
    'terms',
    'review',
  ]);
  assert.deepEqual(getAmendmentWizardSteps('terms_only'), ['path', 'terms', 'review']);
});

test('getAmendmentWizardStepLabel returns combined proposal and billing label', () => {
  assert.equal(getAmendmentWizardStepLabel('proposal_billing'), 'Proposal & Billing');
});

test('migrateLegacyAmendmentWizardStepIndex remaps pre-consolidation plan step indices', () => {
  assert.equal(migrateLegacyAmendmentWizardStepIndex('plan_billing', 0), 0);
  assert.equal(migrateLegacyAmendmentWizardStepIndex('plan_billing', 1), 1);
  assert.equal(migrateLegacyAmendmentWizardStepIndex('plan_billing', 2), 1);
  assert.equal(migrateLegacyAmendmentWizardStepIndex('plan_billing', 3), 2);
  assert.equal(migrateLegacyAmendmentWizardStepIndex('plan_billing', 4), 3);
  assert.equal(migrateLegacyAmendmentWizardStepIndex('terms_only', 2), 2);
});

test('clampAmendmentWizardStepIndex applies legacy migration before clamping', () => {
  assert.equal(clampAmendmentWizardStepIndex('both', 4), 3);
  assert.equal(clampAmendmentWizardStepIndex('plan_billing', 2), 1);
  assert.equal(clampAmendmentWizardStepIndex('terms_only', 10), 2);
});

test('validateAmendmentWizardStep blocks combined proposal and billing step when counts are missing', () => {
  const error = validateAmendmentWizardStep(
    'proposal_billing',
    buildDraft({ managedOutreachVolume: '', managedInboxCount: '' }),
  );
  assert.equal(error, 'Outreach volume is required for managed services.');
});

test('validateAmendmentWizardStep accepts valid combined proposal and billing inputs', () => {
  const error = validateAmendmentWizardStep('proposal_billing', buildDraft());
  assert.equal(error, null);
});

test('validateAmendmentWizardStep validates terms step content', () => {
  const error = validateAmendmentWizardStep('terms', buildDraft({ termsSourceMarkdown: '' }));
  assert.equal(error, 'Agreement markdown is required.');
});

test('validateAmendmentWizardStepNavigation blocks jumps when combined step is incomplete', () => {
  const error = validateAmendmentWizardStepNavigation({
    currentStepIndex: 0,
    targetStepIndex: 3,
    steps: getAmendmentWizardSteps('both'),
    draft: buildDraft({ monthlyRetainer: '' }),
  });

  assert.equal(error, 'Monthly retainer must be greater than zero.');
});

test('validateAmendmentWizardStepNavigation allows backward jumps without validation', () => {
  const error = validateAmendmentWizardStepNavigation({
    currentStepIndex: 2,
    targetStepIndex: 1,
    steps: getAmendmentWizardSteps('both'),
    draft: buildDraft({ monthlyRetainer: '' }),
  });

  assert.equal(error, null);
});

test('amendment wizard draft persistence round-trips without losing fields', () => {
  withMockLocalStorage(() => {
    const key = buildAmendmentWizardStorageKey('acct-123', 'amend-456');
    const draft = {
      wizardPath: 'both',
      stepIndex: 2,
      accountName: 'Acme',
      monthlyRetainer: '4200',
      planTier: 'gold',
      proposalClientLogoUrl: '',
      proposalClientLogoScale: 1,
      proposalClientLogoOffsetX: 0,
      websiteTrafficSourcingEnabled: true,
      replyHandlingEnabled: false,
      agreementType: 'managed_services_agreement',
      managedOutreachVolume: '9000',
      managedInboxCount: '40',
      selectedTermsVersion: 'v1',
      termsSourceMarkdown: '# Updated terms',
    } as const;

    writeAmendmentWizardDraft(key, draft);
    assert.deepEqual(readAmendmentWizardDraft<typeof draft>(key), draft);

    clearAmendmentWizardDraft(key);
    assert.equal(readAmendmentWizardDraft(key), null);
  });
});
