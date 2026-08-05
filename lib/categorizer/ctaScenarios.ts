import type { CategorizerMessageSnippet } from './types';

export type CtaScenarioCategory =
  | 'Interested'
  | 'Neutral'
  | 'Not Interested'
  | 'Auto Reply';

export type CtaScenario = {
  id: string;
  expectedCategory: CtaScenarioCategory;
  outbound: CategorizerMessageSnippet;
  reply: CategorizerMessageSnippet;
  notes?: string;
};

/** Shared permission-CTA outbound used by most CTA fixture rows. */
export const CTA_OUTBOUND_PERMISSION: CategorizerMessageSnippet = {
  subject: 'Quick question about training',
  bodyText:
    'Want me to send the link to the July training recording? Happy to share if useful.',
};

/**
 * Anonymized CTA-aware reply fixtures for prompt assembly + expected-category docs.
 * CI stays offline (scripted LLM); these seed expectedCategory documentation.
 */
export const CTA_SCENARIOS: readonly CtaScenario[] = [
  {
    id: 'affirmative-yes-please',
    expectedCategory: 'Interested',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: { subject: 'Re: Quick question about training', bodyText: 'Yes, please!' },
  },
  {
    id: 'affirmative-that-works',
    expectedCategory: 'Interested',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: { subject: 'Re: Quick question about training', bodyText: 'that works be good!' },
  },
  {
    id: 'affirmative-send-link',
    expectedCategory: 'Interested',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: {
      subject: 'Re: Quick question about training',
      bodyText: 'Yes — please send me the link.',
    },
  },
  {
    id: 'decline-remove-me',
    expectedCategory: 'Not Interested',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: {
      subject: 'Re: Quick question about training',
      bodyText: 'Yes, please remove me from this list and stop contacting me.',
    },
    notes: 'Affirmative wording must lose to decline / remove-me precedence.',
  },
  {
    id: 'soft-later',
    expectedCategory: 'Neutral',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: {
      subject: 'Re: Quick question about training',
      bodyText: 'Not right now — maybe reach out later this quarter.',
    },
  },
  {
    id: 'signature-thanks-only',
    expectedCategory: 'Neutral',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: {
      subject: 'Re: Quick question about training',
      bodyText: 'Thanks.\n\nJordan Lee\nDirector of Ops',
    },
  },
  {
    id: 'bump-confusion',
    expectedCategory: 'Neutral',
    outbound: {
      subject: 'Following up',
      bodyText: 'Just bumping this in case it got buried — any thoughts?',
    },
    reply: { subject: 'Re: Following up', bodyText: 'Just let me know!' },
    notes: 'Ambiguous after a sequence bump; not a clear CTA accept.',
  },
  {
    id: 'empty-quote-only',
    expectedCategory: 'Neutral',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: { subject: 'Re: Quick question about training', bodyText: '' },
    notes: 'Empty / quote-stripped reply must not infer Interested from outbound.',
  },
  {
    id: 'ooo',
    expectedCategory: 'Auto Reply',
    outbound: CTA_OUTBOUND_PERMISSION,
    reply: {
      subject: 'Out of Office: Re: Quick question about training',
      bodyText:
        'I am out of the office until Monday, March 16th, with limited email access. I will respond when I return.',
    },
  },
] as const;
