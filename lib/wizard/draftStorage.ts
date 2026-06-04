const WIZARD_DRAFT_LOGO_URL_MAX_LENGTH = 2048;

/** Strip fields that commonly blow the ~5MB localStorage origin quota. */
export function prepareWizardDraftForStorage<T extends Record<string, unknown>>(draft: T): T {
  const prepared = { ...draft };

  if (typeof prepared.proposalClientLogoUrl === 'string') {
    const logoUrl = prepared.proposalClientLogoUrl;
    if (logoUrl.startsWith('data:') || logoUrl.length > WIZARD_DRAFT_LOGO_URL_MAX_LENGTH) {
      prepared.proposalClientLogoUrl = '';
    }
  }

  return prepared;
}

export function readWizardDraft<T>(storageKey: string): T | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { data?: T } | T;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'data' in parsed &&
      parsed.data !== undefined
    ) {
      return parsed.data;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function writeWizardDraft<T extends Record<string, unknown>>(storageKey: string, draft: T) {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const payload = JSON.stringify({
    savedAt: Date.now(),
    data: prepareWizardDraftForStorage(draft),
  });

  const tryWrite = () => window.localStorage.setItem(storageKey, payload);

  try {
    tryWrite();
  } catch {
    // QuotaExceededError — prune other furnace wizard drafts and retry once.
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('furnace:') && key !== storageKey) {
          window.localStorage.removeItem(key);
        }
      }
      tryWrite();
    } catch {
      // Skip autosave rather than crashing the wizard.
    }
  }
}

export function clearWizardDraft(storageKey: string) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(storageKey);
}
