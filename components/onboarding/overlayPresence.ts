import { useEffect, useState } from 'react';

/**
 * Tiny global registry tracking how many blocking overlays (modals, bottom
 * sheets, dialogs) are currently open. The onboarding provider reads this so it
 * never starts a flow on top of — or fights with — an open modal.
 *
 * Blocking surfaces register themselves while visible via
 * `useRegisterBlockingOverlay(visible)`.
 */

let count = 0;
const listeners = new Set<(n: number) => void>();

function emit() {
  for (const listener of listeners) listener(count);
}

export function pushBlockingOverlay(): () => void {
  count += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    emit();
  };
}

export function getBlockingOverlayCount(): number {
  return count;
}

/** Register a blocking overlay while `active` is true. */
export function useRegisterBlockingOverlay(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const release = pushBlockingOverlay();
    return release;
  }, [active]);
}

/** Subscribe to whether any blocking overlay is currently open. */
export function useBlockingOverlayPresent(): boolean {
  const [present, setPresent] = useState(() => count > 0);
  useEffect(() => {
    const listener = (n: number) => setPresent(n > 0);
    listeners.add(listener);
    listener(count);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return present;
}
