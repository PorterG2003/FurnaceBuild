import { TARGETS, type OnboardingFlowDef } from '../types';

/**
 * Master Inbox deep-dive — mobile (PWA). Same capabilities as the desktop tour
 * but sequenced across the list → thread view, and it teaches the buried power
 * tools for real: the user presses the "⋮" actions button (opening the sheet),
 * then the next step highlights the actions inside it.
 *
 * Mandatory unless the desktop tour was already completed (`mandatoryUnlessSeen`).
 * Real cutout spotlights work on mobile web; native falls back to the dimmed
 * bottom card.
 */
export const inboxMobileFlow: OnboardingFlowDef = {
  id: 'inbox-mobile',
  version: 1,
  reshowOnVersionBump: true,
  mandatory: true,
  mandatoryUnlessSeen: 'inbox',
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
      title: 'Open a conversation',
      body: 'Open conversations glow — that is your triage queue. Tap one to keep going.',
      placement: 'bottom',
      advance: 'onTargetPress',
      dwellMs: 2500,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxLeadDetail,
      title: 'The full lead, in place',
      body: 'Tap the name for the complete lead profile — company, campaign, and history.',
      placement: 'bottom',
      advance: 'manual',
      dwellMs: 3000,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxMobileActions,
      title: 'Your power tools live here',
      body: 'Tap to open the actions for this conversation.',
      placement: 'bottom',
      advance: 'onTargetPress',
      dwellMs: 2500,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxSheetActions,
      title: 'Categorize, replace, block, close',
      body: 'Categorize a reply, replace a wrong contact, block a sender, or close the conversation when it is handled.',
      placement: 'top',
      advance: 'manual',
      dwellMs: 4000,
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxMessagePane,
      title: 'Reply right here',
      body: 'Respond inline — Smart Handling flags the replies that actually need a human.',
      placement: 'top',
      advance: 'manual',
      dwellMs: 3000,
    },
  ],
};
