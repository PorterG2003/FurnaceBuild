import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlatformInviteWizardStorageKey,
  clearPlatformInviteWizardDraft,
  getInviteWizardSteps,
  readPlatformInviteWizardDraft,
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
    stepIndex: 2,
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

test('getInviteWizardSteps swaps proposal/access label by agreement type', () => {
  assert.deepEqual(getInviteWizardSteps('managed_services_agreement'), [
    'Client',
    'Billing',
    'Proposal',
    'Terms',
    'Review',
    'Approval',
  ]);
  assert.deepEqual(getInviteWizardSteps('platform_agreement'), [
    'Client',
    'Billing',
    'Access',
    'Terms',
    'Review',
    'Approval',
  ]);
});

test('validateInviteWizardStep blocks managed services proposal step when counts are missing', () => {
  const error = validateInviteWizardStep(2, buildDraft({ managedOutreachVolume: '', managedInboxCount: '' }));
  assert.equal(error, 'Outreach volume is required for managed services.');
});

test('validateInviteWizardStep accepts valid managed services proposal inputs', () => {
  const error = validateInviteWizardStep(2, buildDraft());
  assert.equal(error, null);
});

test('platform invite wizard draft persistence round-trips without losing fields', () => {
  withMockLocalStorage(() => {
    const key = buildPlatformInviteWizardStorageKey('invite-123');
    const draft = buildDraft({ stepIndex: 3, termsSourceMarkdown: 'Updated markdown' });

    writePlatformInviteWizardDraft(key, draft);
    assert.deepEqual(readPlatformInviteWizardDraft(key), draft);

    clearPlatformInviteWizardDraft(key);
    assert.equal(readPlatformInviteWizardDraft(key), null);
  });
});
