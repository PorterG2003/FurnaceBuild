import { TARGETS, type OnboardingFlowDef } from '../types';

/**
 * Master Inbox deep-dive — desktop. Mandatory the first time a user reaches a
 * populated inbox (see `mandatoryUnlessSeen`: once the mobile tour is done this
 * one becomes an optional replay). Fires on the *next* inbox visit after a
 * reply already exists, never mid-task — see `useOnboardingTrigger` timing.
 *
 * Every step sells a capability users miss on their own; `dwellMs` gives each
 * one a short read-gate so the tour is absorbed, not clicked through.
 */
export const inboxFlow: OnboardingFlowDef = {
  id: 'inbox',
  version: 1,
  reshowOnVersionBump: true,
  mandatory: true,
  mandatoryUnlessSeen: 'inbox-mobile',
  steps: [
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxCategories,
      title: 'Slice your inbox',
      body: 'Filter by campaign, category, unread, and open vs. closed to work one pile at a time.',
      placement: 'bottom',
      advance: 'manual',
      dwellMs: 3000,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxThreadList,
      title: 'Your triage queue',
      body: 'Open conversations glow — that is what needs you. Open one to keep going.',
      placement: 'right',
      advance: 'onTargetPress',
      dwellMs: 2500,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxLeadDetail,
      title: 'The full lead, in place',
      body: "Tap the name for the complete lead profile — company, campaign, and history — without leaving the inbox.",
      placement: 'bottom',
      advance: 'manual',
      dwellMs: 3000,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxThreadActions,
      title: 'Your power tools',
      body: 'Categorize a reply, replace a wrong contact, block a sender, or close the conversation when it is handled.',
      placement: 'bottom',
      advance: 'manual',
      dwellMs: 4000,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxMessagePane,
      title: 'Reply right here',
      body: 'Respond inline — Smart Handling flags the replies that actually need a human.',
      placement: 'left',
      advance: 'manual',
      dwellMs: 3000,
    },
  ],
};
