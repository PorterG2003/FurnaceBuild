import { TARGETS, type OnboardingFlowDef } from '../types';

/**
 * Inbox follow-up actions - mobile. Opens the actions sheet once, then covers
 * the full sequence of everyday and special-case thread actions.
 *
 * The row steps (`inboxAction*`) render inside the sheet, so they declare
 * `hostId: 'inboxMessageActions'`; the lead-detail and sheet-open steps stay
 * on the plain screen surface and are left global.
 */
export const inboxFollowupMobileFlow: OnboardingFlowDef = {
  id: 'inbox-followup-mobile',
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
      targetId: TARGETS.inboxMobileActions,
      title: 'Work the reply from here',
      body: 'Open this menu to close the thread, save context with tags, classify the reply, or handle special cases.',
      placement: 'bottom',
      advance: 'onTargetPress',
      nextGate: { dwellMs: 2500 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionClose,
      hostId: 'inboxMessageActions',
      title: 'Close handled threads',
      body: 'Once you have handled the reply, close the conversation so your open queue stays focused. Any new reply opens it again automatically.',
      placement: 'top',
      advance: 'manual',
      nextGate: { dwellMs: 4000 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionBlock,
      hostId: 'inboxMessageActions',
      title: 'Stop future follow-up',
      body: 'Use Block List when this sender should never be contacted again. This is the hard stop for do-not-contact or wrong-fit senders.',
      placement: 'top',
      advance: 'manual',
      nextGate: { dwellMs: 3200 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionOutOfOffice,
      hostId: 'inboxMessageActions',
      title: 'Pause follow-up until they are back',
      body: 'Use Out of Office when someone says they are away and gives you a real return window. This pauses follow-up now and lets outreach resume when timing makes sense.',
      placement: 'top',
      advance: 'manual',
      nextGate: { dwellMs: 3600 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionReplace,
      hostId: 'inboxMessageActions',
      title: 'Move to the better contact',
      body: 'Use Replace + forward when the thread points you to the wrong person or a better contact. It keeps the context and moves the campaign to the better lead.',
      placement: 'top',
      advance: 'manual',
      nextGate: { dwellMs: 3400 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionTags,
      hostId: 'inboxMessageActions',
      title: 'Save context with tags',
      body: 'Use tags to capture context your team will want later, like objections, buying signals, or follow-up notes.',
      placement: 'top',
      advance: 'manual',
      nextGate: { dwellMs: 3400 },
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.inboxActionCategory,
      hostId: 'inboxMessageActions',
      title: 'Classify the reply',
      body: 'Use category to label what this reply means: Interested, Neutral, Not Interested, or Auto Reply.',
      placement: 'top',
      advance: 'manual',
      nextGate: { dwellMs: 3200 },
    },
  ],
};
