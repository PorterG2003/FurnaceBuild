import { createElement } from 'react';
import { TARGETS, type OnboardingFlowDef } from '../types';

/**
 * AUTHORING TEMPLATE — not registered, not active.
 *
 * Copy this file to e.g. `welcome.ts`, fill it in, then register it in
 * `index.ts` (`FLOWS = { welcome: welcomeFlow }`). Add the matching anchors to
 * screens with `useOnboardingTarget(TARGETS.x)` and fire it with
 * `useOnboardingTrigger('welcome', { when })`.
 *
 * Key shapes this demonstrates:
 * - `autoStart`: only the welcome flow should use it (fires once on first login).
 *   Every other flow is started by a screen-owned `useOnboardingTrigger`.
 * - `SegmentCopy`: a string for shared copy, or `{ default, dfy }` to vary the
 *   framing for done-for-you clients. `resolveFlow` picks the right string.
 * - `requiresRole`: drop a step for members who can't act on it (e.g. team /
 *   billing / API steps that only make sense for owner/admin).
 * - Announcement steps render a (lazily-imported) illustration node; spotlight
 *   steps highlight a registered `TARGETS` anchor.
 *
 * This file is exported but deliberately NOT added to the registry, so the
 * system stays dormant until real flows are authored.
 */
export const templateFlow: OnboardingFlowDef = {
  id: 'welcome',
  version: 1,
  autoStart: true,
  steps: [
    {
      kind: 'announcement',
      title: {
        default: 'Welcome to Furnace',
        dfy: 'Welcome to Furnace',
      },
      description: {
        default: 'A quick tour of where things live. You can skip anytime.',
        dfy: 'Here is where to find your replies and results. You can skip anytime.',
      },
      maxWidth: '5xl',
      // Announcement steps compose their hero inside `AnnouncementModal`
      // (`AnnouncementHero`). For a bespoke illustration, build a component on
      // `components/onboarding/art/AnnouncementArtCard.tsx` (see `WelcomeArt.tsx`)
      // and return it here.
      render: () => createElement('view'),
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.navItems,
      title: 'Your navigation',
      body: {
        default: 'Jump between campaigns, metrics, your inbox, and leads from here.',
        dfy: 'Jump between your inbox, metrics, and lead data from here.',
      },
      placement: 'right',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.accountTeam,
      title: 'Invite your team',
      body: 'Add teammates and manage access from your workspace settings.',
      placement: 'bottom',
      advance: 'manual',
      // Only owners/admins can manage the team, so members skip this step.
      requiresRole: ['owner', 'admin'],
    },
  ],
};
