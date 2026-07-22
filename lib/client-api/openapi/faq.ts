import { API_KEY_PREFIX } from './constants.js';
import { guideLink, referenceLink, type DocLinkMode } from './docLinks.js';

/** Plain-language FAQ for newcomers. */
export function buildFaqMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    '## How do I get an API key?',
    '',
    'Create one in Furnace under **Account Settings \u2192 API keys**. Keys start with `' +
      API_KEY_PREFIX +
      '` and are sent in the `Authorization` header. See ' +
      guideLink('Authentication', '/guides/authentication/', linkMode) +
      '.',
    '',
    '## What is the base URL?',
    '',
    'Your Furnace Client API host, for example `https://api.getfurnace.io`. Every endpoint lives under `/v1/`.',
    '',
    '## What do I build first?',
    '',
    'Start with the ' +
      guideLink('Quickstart', '/guides/quickstart/', linkMode) +
      ' to make your first request, then the ' +
      guideLink('Campaign setup', '/guides/campaign-setup/', linkMode) +
      ' guide to launch a real campaign.',
    '',
    '## Can I change a campaign after it is live?',
    '',
    'Yes, but with limits. While a campaign is running you can edit email copy and timing. To add, remove, or reorder steps, pause the campaign first, make your changes, then resume. Stopped campaigns cannot be edited. See ' +
      guideLink('Campaigns', '/concepts/campaigns/', linkMode) +
      '.',
    '',
    '## How do I personalize emails?',
    '',
    'Use `{{first_name}}` for standard details and `{{custom.company}}` for custom fields in the subject or body. See ' +
      guideLink('Email sequences', '/concepts/sequences/', linkMode) +
      '.',
    '',
    '## Why is a person not getting emails?',
    '',
    'The most common reasons: the campaign is still a draft (launch it), the person is missing a required custom field, or the campaign has no mailbox assigned. The ' +
      guideLink('Campaign setup', '/guides/campaign-setup/', linkMode) +
      ' guide covers each of these.',
    '',
    '## How do I know when something happens?',
    '',
    'Use webhooks to get notified when emails send, replies arrive, and more \u2014 see ' +
      guideLink('Webhooks', '/concepts/webhooks/', linkMode) +
      '. You can also read status directly through the ' +
      referenceLink('API Reference', '/reference/', linkMode) +
      '.',
    '',
    '## Can I use campaigns imported from Smartlead?',
    '',
    'You can read them, but they are not editable through this API.',
  ].join('\n');
}
