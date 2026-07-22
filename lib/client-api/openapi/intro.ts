import { API_KEY_PREFIX } from './constants.js';
import { docsPublicPath, guideLink, referenceLink, type DocLinkMode } from './docLinks.js';

/** Authentication guide: keys, header format, base URL, account scope. */
export function buildAuthenticationMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Every request needs an API key. Keys are tied to a single Furnace account, so requests never touch another account\u2019s data.',
    '',
    '## Get a key',
    '',
    'Create an API key in Furnace under **Account Settings \u2192 API keys**. Keys start with `' +
      API_KEY_PREFIX +
      '`. Copy it once and store it somewhere safe \u2014 you can revoke and recreate keys at any time.',
    '',
    '## Send it with every request',
    '',
    'Pass your key in the `Authorization` header:',
    '',
    '```http',
    `Authorization: Bearer ${API_KEY_PREFIX}your_key_here`,
    '```',
    '',
    'The base URL is your Furnace Client API host, for example `https://api.getfurnace.io`. All endpoints live under `/v1/`.',
    '',
    '```bash',
    `curl -sS 'https://api.getfurnace.io/v1/mailboxes' \\`,
    `  -H 'Authorization: Bearer ${API_KEY_PREFIX}your_key_here'`,
    '```',
    '',
    '## If a key is wrong',
    '',
    'A missing, revoked, expired, or unknown key returns `401` with an `authentication_error`. Double-check the header format and that the key is still active.',
    '',
    `Next: ${guideLink('Quickstart', '/guides/quickstart/', linkMode)}.`,
  ].join('\n');
}

/**
 * Plain-language product overview shared by the intro MDX and contract tests.
 * No API conventions here — endpoint/field reference lives in the API Reference tab.
 */
export function buildClientApiIntroMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Furnace sends sequences of personalized emails to a list of people, from one or more of your inboxes. It waits between steps and can branch based on how people reply.',
    '',
    'This API does everything the app does, from your own code: create campaigns, add people, launch sending, read replies, and get notified through webhooks.',
    '',
    '## What you can build',
    '',
    '- **Campaigns** — create a campaign, add an email sequence, and launch it.',
    '- **People** — add, import, and move the people a campaign emails.',
    '- **Replies** — find replies, send responses, and track message jobs.',
    '- **Webhooks** — get notified when emails send, replies arrive, and more.',
    '',
    '## Start here',
    '',
    `1. ${guideLink('Quickstart', '/guides/quickstart/', linkMode)} — get an API key and make your first request.`,
    `2. ${guideLink('Campaign setup', '/guides/campaign-setup/', linkMode)} — build and launch a campaign end to end.`,
    `3. ${guideLink('Lead management', '/guides/lead-management/', linkMode)} and ${guideLink('Handling replies', '/guides/handling-replies/', linkMode)} — day-two operations.`,
    '',
    `Need a specific endpoint or field? The ${referenceLink('API Reference', '/reference/', linkMode)} documents every route and object.`,
  ].join('\n');
}

/** Fumadocs MDX home page: hero, "what you can build" cards, and where to go next. */
export function buildClientApiIntroMdx(linkMode: DocLinkMode = 'docs'): string {
  const quickstartHref = docsPublicPath('/guides/quickstart/');
  const referenceHref = docsPublicPath('/reference/');
  return [
    '<div className="doc-hero not-prose">',
    '',
    '<p className="doc-hero__tagline">',
    'Furnace runs personalized cold email campaigns. Create campaigns, add people, launch sending, and handle replies — all from your own code.',
    '</p>',
    '',
    '<div className="doc-hero__actions">',
    `<a className="primary" href="${quickstartHref}">Quickstart</a>`,
    `<a className="secondary" href="${referenceHref}">API Reference</a>`,
    '</div>',
    '',
    '</div>',
    '',
    'Furnace sends sequences of personalized emails to a list of people, from one or more of your inboxes. It waits between steps and can branch based on how people reply.',
    '',
    '## What you can build',
    '',
    '<CardGroup cols={2}>',
    '',
    `<Card title="Campaigns" icon="rocket" href="${docsPublicPath('/guides/campaign-setup/')}">`,
    '',
    'Create a campaign, add an email sequence, and launch it.',
    '',
    '</Card>',
    '',
    `<Card title="People" icon="book" href="${docsPublicPath('/guides/lead-management/')}">`,
    '',
    'Add, import, and move the people a campaign emails.',
    '',
    '</Card>',
    '',
    `<Card title="Replies" icon="terminal" href="${docsPublicPath('/guides/handling-replies/')}">`,
    '',
    'Find replies, send responses, and track message jobs.',
    '',
    '</Card>',
    '',
    `<Card title="Webhooks" icon="plug" href="${docsPublicPath('/guides/webhook-integration/')}">`,
    '',
    'Get notified when emails send, replies arrive, and more.',
    '',
    '</Card>',
    '',
    '</CardGroup>',
    '',
    '## Start here',
    '',
    `1. ${guideLink('Quickstart', '/guides/quickstart/', linkMode)} — get an API key and make your first request.`,
    `2. ${guideLink('Campaign setup', '/guides/campaign-setup/', linkMode)} — build and launch a campaign end to end.`,
    `3. ${guideLink('Lead management', '/guides/lead-management/', linkMode)} and ${guideLink('Handling replies', '/guides/handling-replies/', linkMode)} — day-two operations.`,
    '',
    `Every endpoint and object is documented in the ${referenceLink('API Reference', '/reference/', linkMode)}. New keys are created in Furnace Account Settings and sent as \`Authorization: Bearer ${API_KEY_PREFIX}...\` — see ${guideLink('Authentication', '/guides/authentication/', linkMode)}.`,
  ].join('\n');
}
