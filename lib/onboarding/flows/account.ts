import { TARGETS, type OnboardingFlowDef } from '../types';

export const accountFlow: OnboardingFlowDef = {
  id: 'account',
  version: 8,
  reshowOnVersionBump: true,
  steps: [
    {
      kind: 'spotlight',
      targetId: TARGETS.accountProfile,
      title: 'Your profile',
      body: {
        default: 'Your name and company details. Login email is shown here but cannot be edited.',
        dfy: 'Your name and company info — used to identify your workspace.',
      },
      placement: 'bottom',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.accountNotifications,
      title: 'Never miss a reply',
      body: {
        default:
          'Turn on Device Push for Email Replies so a hot lead never sits unseen — allow alerts on this device, then enable Device Push. The tour continues once it is on.',
        dfy: 'Turn on reply alerts so you know the moment someone writes back — allow device alerts, then enable Device Push.',
      },
      placement: 'bottom',
      advance: 'manual',
      nextGate: {
        waitForSignal: true,
      },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.accountTeam,
      title: 'Team and access',
      body: {
        default: 'Invite teammates by email. Owners and admins can change roles or revoke access.',
        dfy: 'Add colleagues who need inbox and metrics access.',
      },
      placement: 'bottom',
      advance: 'manual',
      requiresRole: ['owner', 'admin'],
    },

  ],
};
