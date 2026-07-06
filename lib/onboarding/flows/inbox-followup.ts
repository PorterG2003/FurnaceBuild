import { TARGETS, type OnboardingFlowDef } from '../types';

/**
 * Inbox follow-up actions - desktop. Covers lead context, everyday thread
 * handling, reply classification, and special-case actions in one coherent
 * follow-up lesson after the basics tour.
 *
 * Toolbar-backed actions author only the real lessons. When some actions
 * collapse into the responsive overflow menu, `buildInboxToolbarFlow` inserts a
 * single generic opener immediately before the first overflowed action.
 */
export const inboxFollowupFlow: OnboardingFlowDef = {
  id: 'inbox-followup',
  version: 2,
  steps: [
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxLeadDetail,
      title: 'Lead info lives here',
      body: 'If you need more context, this opens the full lead profile with phone numbers and other lead info.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 3000 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxThreadActions,
      title: 'Work the reply from here',
      body: 'These controls help you finish the thread: close it, save context with tags, classify the reply, or handle special cases.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 2800 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionClose,
      title: 'Close handled threads',
      body: 'Once you have handled the reply, close the conversation so your open queue stays focused. Any new reply opens it again automatically.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 4000 },
      toolbarActionKey: 'close',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionBlock,
      title: 'Stop future follow-up',
      body: 'Use Block List when this sender should never be contacted again. This is the hard stop for do-not-contact or wrong-fit senders.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 3200 },
      toolbarActionKey: 'block',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionOutOfOffice,
      title: 'Pause follow-up until they are back',
      body: 'Use Out of Office when someone says they are away and gives you a real return window. This pauses follow-up now and lets outreach resume when timing makes sense.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 3600 },
      toolbarActionKey: 'ooo',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionReplace,
      title: 'Move to the better contact',
      body: 'Use Replace + forward when the thread points you to the wrong person or a better contact. It keeps the context and moves the campaign to the better lead.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 3400 },
      toolbarActionKey: 'replace',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionTags,
      title: 'Save context with tags',
      body: 'Use tags to capture context your team will want later, like objections, buying signals, or follow-up notes.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 3400 },
      toolbarActionKey: 'tags',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionCategory,
      title: 'Classify the reply',
      body: 'Use category to label what this reply means: Interested, Neutral, Not Interested, or Auto Reply.',
      placement: 'bottom',
      advance: 'manual',
      nextGate: { dwellMs: 3200 },
    },
  ],
};
