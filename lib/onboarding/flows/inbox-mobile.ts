import { TARGETS, type OnboardingFlowDef } from '../types';

/** Inbox basics — mobile (PWA). Short mandatory intro to the open-thread queue. */
export const inboxMobileFlow: OnboardingFlowDef = {
  id: 'inbox-mobile',
  version: 5,
  reshowOnVersionBump: true,
  mandatory: true,
  mandatoryUnlessSeen: 'inbox',
  steps: [
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxCategories,
      title: 'Filter your inbox',
      body: 'Filter by campaign, category, unread, and open vs. closed so you can work your open queue one pile at a time. Use Sort to prioritize open or unread threads.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 3000 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxThreadList,
      title: 'Your triage queue',
      body: 'Threads show newest activity first. Open ones are marked with a dot so you can spot what still needs you.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 2500 },
      scrollIntoView: false,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxOpenIndicator,
      title: 'This means open',
      body: 'This dot means the thread is open.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 2200 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxOpenThread,
      title: 'Open this thread',
      body: 'Tap thread to continue',
      placement: 'bottom',
      advance: 'onTargetPress',
      nextGate: { dwellMs: 2500 },
    },
  ],
};
