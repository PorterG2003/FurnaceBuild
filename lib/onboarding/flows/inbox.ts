import { TARGETS, type OnboardingFlowDef } from '../types';

/** Inbox basics — desktop. Short mandatory intro to the open-thread queue. */
export const inboxFlow: OnboardingFlowDef = {
  id: 'inbox',
  version: 6,
  reshowOnVersionBump: true,
  mandatory: true,
  mandatoryUnlessSeen: 'inbox-mobile',
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
      placement: 'right',
      advance: 'manual',
      nextGate: { dwellMs: 2500 },
      scrollIntoView: false,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxOpenIndicator,
      title: 'This means open',
      body: 'This dot means the thread is open.',
      placement: 'right',
      advance: 'manual',
      nextGate: { dwellMs: 2200 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxOpenThread,
      title: 'Open this thread',
      body: 'Tap thread to continue',
      placement: 'right',
      advance: 'onTargetPress',
      nextGate: { dwellMs: 2500 },
    },
  ],
};
