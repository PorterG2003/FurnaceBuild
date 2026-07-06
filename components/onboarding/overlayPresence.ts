import { useEffect, useState } from 'react';
import type { OnboardingHostId } from '@/lib/onboarding/onboardingHosts';

/**
 * Tiny global registry tracking how many blocking overlays (modals, bottom
 * sheets, dialogs) are currently open. The onboarding provider reads this so it
 * never starts a flow on top of — or fights with — an open modal.
 *
 * Blocking surfaces register themselves while visible via
 * `useRegisterBlockingOverlay(visible)`.
 *
 * Separately, modal surfaces that can *host* an onboarding spotlight inside
 * themselves register via `useRegisterOnboardingHost(hostId, active)`. Host
 * registration is deliberately kept out of the blocking count: a host surface
 * highlights onboarding rather than fighting it, so it must not suppress the
 * flow the way an unrelated modal does.
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

// --- Onboarding host registry --------------------------------------------
// Which modal hosts (by id) are currently mounted+active. Separate from the
// blocking count so a host never suppresses the flow it is meant to display.

const hostCounts = new Map<OnboardingHostId, number>();
const hostListeners = new Set<() => void>();

function emitHosts() {
  for (const listener of hostListeners) listener();
}

/** Registers `hostId` as mounted while it holds; returns a release fn. */
export function pushOnboardingHost(hostId: OnboardingHostId): () => void {
  hostCounts.set(hostId, (hostCounts.get(hostId) ?? 0) + 1);
  emitHosts();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (hostCounts.get(hostId) ?? 0) - 1;
    if (next <= 0) hostCounts.delete(hostId);
    else hostCounts.set(hostId, next);
    emitHosts();
  };
}

/** True while at least one instance of `hostId` is mounted. */
export function isOnboardingHostMounted(hostId: OnboardingHostId): boolean {
  return (hostCounts.get(hostId) ?? 0) > 0;
}

/** Register a modal host while `active` is true (does not block onboarding). */
export function useRegisterOnboardingHost(
  hostId: OnboardingHostId | null | undefined,
  active: boolean,
): void {
  useEffect(() => {
    if (!hostId || !active) return;
    const release = pushOnboardingHost(hostId);
    return release;
  }, [hostId, active]);
}

/** Subscribe to whether `hostId` is currently mounted. */
export function useIsOnboardingHostMounted(hostId: OnboardingHostId): boolean {
  const [mounted, setMounted] = useState(() => isOnboardingHostMounted(hostId));
  useEffect(() => {
    const listener = () => setMounted(isOnboardingHostMounted(hostId));
    hostListeners.add(listener);
    listener();
    return () => {
      hostListeners.delete(listener);
    };
  }, [hostId]);
  return mounted;
}
