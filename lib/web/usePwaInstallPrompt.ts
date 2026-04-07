import { useCallback, useLayoutEffect, useState } from 'react';
import { Platform } from 'react-native';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type PwaInstallOutcome = 'accepted' | 'dismissed' | 'failed' | null;

const STORED_KEY = '__furnaceDeferredInstallPrompt' as const;

function readStoredDeferredPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { [STORED_KEY]?: BeforeInstallPromptEvent | null };
  const e = w[STORED_KEY];
  if (!e || typeof e.prompt !== 'function') return null;
  return e;
}

function writeStoredDeferredPrompt(e: BeforeInstallPromptEvent | null) {
  if (typeof window === 'undefined') return;
  const w = window as Window & { [STORED_KEY]?: BeforeInstallPromptEvent | null };
  w[STORED_KEY] = e;
}

/**
 * Captures `beforeinstallprompt` for `prompt()` (Chrome / Edge / Samsung Internet on Android, etc.).
 * `public/index.html` stores the event as soon as it fires; this hook syncs from that store because
 * the event often fires before React mounts.
 */
export function usePwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(() =>
    Platform.OS === 'web' ? readStoredDeferredPrompt() : null,
  );

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const syncFromStore = () => {
      const next = readStoredDeferredPrompt();
      if (next) setDeferred(next);
    };

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      writeStoredDeferredPrompt(ev);
      setDeferred(ev);
    };

    const onAppInstalled = () => {
      writeStoredDeferredPrompt(null);
      setDeferred(null);
    };

    syncFromStore();

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('furnace-deferred-install-prompt', syncFromStore);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('furnace-deferred-install-prompt', syncFromStore);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<PwaInstallOutcome> => {
    const ev = readStoredDeferredPrompt() ?? deferred;
    if (!ev) return null;
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      writeStoredDeferredPrompt(null);
      setDeferred(null);
      return outcome;
    } catch {
      return 'failed';
    }
  }, [deferred]);

  return {
    canPromptInstall: deferred !== null,
    promptInstall,
  };
}
