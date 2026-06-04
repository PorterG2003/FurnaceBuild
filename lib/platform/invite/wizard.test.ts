import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlatformInviteWizardStorageKey,
  clearPlatformInviteWizardDraft,
  clampInviteWizardStepIndex,
  getInviteWizardSteps,
  migrateLegacyInviteWizardStepIndex,
  readPlatformInviteWizardDraft,
  validateInviteWizardStepNavigation,
  validateInviteWizardStep,
  writePlatformInviteWizardDraft,
  type PlatformInviteWizardDraft,
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

function buildDraft(overrides: Partial<PlatformInviteWizardDraft> = {}): PlatformInviteWizardDraft {
  return {
    stepIndex: 1,
    inviteEmail: 'test@example.com',
    inviteCompanyName: 'Acme',
    inviteMonthlyRetainer: '1800',
    inviteFirstMonthDiscount: '0',
    planTier: 'silver',
    proposalClientLogoUrl: '',
    proposalClientLogoScale: 1,
    proposalClientLogoOffsetX: 0,
    websiteTrafficSourcingEnabled: false,
    replyHandlingEnabled: false,
    agreementType: 'managed_services_agreement',
    managedOutreachVolume: '5000',
    managedInboxCount: '25',
    selectedTermsVersion: 'managed-services-agreement-current',
    termsSourceMarkdown: '# Terms',
    autoAddInternalAdmins: true,
    ...overrides,
  };
}

test('getInviteWizardSteps uses consolidated proposal and billing step', () => {
  assert.deepEqual(getInviteWizardSteps('managed_services_agreement'), [
    'Client',
    'Proposal & Billing',
    'Terms',
    'Review',
    'Approval',
  ]);
  assert.deepEqual(getInviteWizardSteps('platform_agreement'), [
    'Client',
    'Proposal & Billing',
    'Terms',
    'Review',
    'Approval',
  ]);
});

test('migrateLegacyInviteWizardStepIndex maps old six-step indices', () => {
  assert.equal(migrateLegacyInviteWizardStepIndex(0), 0);
  assert.equal(migrateLegacyInviteWizardStepIndex(1), 1);
  assert.equal(migrateLegacyInviteWizardStepIndex(2), 1);
  assert.equal(migrateLegacyInviteWizardStepIndex(3), 2);
  assert.equal(migrateLegacyInviteWizardStepIndex(4), 3);
  assert.equal(migrateLegacyInviteWizardStepIndex(5), 4);
});

test('clampInviteWizardStepIndex applies legacy migration', () => {
  assert.equal(clampInviteWizardStepIndex(5, 'managed_services_agreement'), 4);
  assert.equal(clampInviteWizardStepIndex(2, 'platform_agreement'), 1);
});

test('validateInviteWizardStep blocks combined proposal and billing step when counts are missing', () => {
  const error = validateInviteWizardStep(
    1,
    buildDraft({ managedOutreachVolume: '', managedInboxCount: '' }),
  );
  assert.equal(error, 'Outreach volume is required for managed services.');
});

test('validateInviteWizardStep accepts valid combined proposal and billing inputs', () => {
  const error = validateInviteWizardStep(1, buildDraft());
  assert.equal(error, null);
});

test('validateInviteWizardStep validates terms on step 2', () => {
  const error = validateInviteWizardStep(2, buildDraft({ termsSourceMarkdown: '' }));
  assert.equal(error, 'Agreement markdown is required.');
});

test('validateInviteWizardStepNavigation blocks jumps when an earlier required step is incomplete', () => {
  const error = validateInviteWizardStepNavigation({
    currentStepIndex: 0,
    targetStepIndex: 3,
    agreementType: 'managed_services_agreement',
    draft: buildDraft({ inviteEmail: '' }),
  });

  assert.equal(error, 'Invite email is required.');
});

test('validateInviteWizardStepNavigation allows backward jumps without validation', () => {
  const error = validateInviteWizardStepNavigation({
    currentStepIndex: 3,
    targetStepIndex: 1,
    agreementType: 'managed_services_agreement',
    draft: buildDraft({ inviteEmail: '' }),
  });

  assert.equal(error, null);
});

test('platform invite wizard draft persistence round-trips without losing fields', () => {
  withMockLocalStorage(() => {
    const key = buildPlatformInviteWizardStorageKey('invite-123');
    const draft = buildDraft({ stepIndex: 2, termsSourceMarkdown: 'Updated markdown' });

    writePlatformInviteWizardDraft(key, draft);
    assert.deepEqual(readPlatformInviteWizardDraft(key), draft);

    clearPlatformInviteWizardDraft(key);
    assert.equal(readPlatformInviteWizardDraft(key), null);
  });
});
