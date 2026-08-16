import { guideLink, referenceLink, type DocLinkMode } from './docLinks.js';

/** Core Concept: what a campaign is and its lifecycle, in plain language. */
export function buildCampaignsConceptMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'A campaign is one outbound effort: a set of people, an email sequence, and the inboxes it sends from. Everything you do through the API hangs off a campaign.',
    '',
    'A campaign moves through a few simple states:',
    '',
    '| State | What it means |',
    '| --- | --- |',
    '| **Draft** | You are still building it. Add or change anything — steps, people, inboxes. Nothing sends yet. |',
    '| **Running** | It is live and sending. You can still edit email copy and timing, but not add or remove steps. |',
    '| **Paused** | Sending is on hold. You can restructure the sequence again, then resume. |',
    '| **Stopped** | Finished. No more sending and no more edits. |',
    '',
    'The usual path is **draft \u2192 launch \u2192 running**, with pause and resume whenever you need to make bigger changes.',
    '',
    `Ready to build one? Follow the ${guideLink('Campaign setup', '/guides/campaign-setup/', linkMode)} guide. To see the exact fields, check the ${referenceLink('API Reference', '/reference/', linkMode)}.`,
    '',
    '> Campaigns imported from Smartlead are read-only through this API.',
  ].join('\n');
}

/** Core Concept: leads vs people vs saved lists. */
export function buildLeadsPeopleConceptMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'A **person** is someone in your account — an email address with details like name and company. The same person can be in more than one campaign.',
    '',
    'A **lead** is a person as they appear inside a specific campaign. When you add someone to a campaign, you create a lead there. Removing a lead from a campaign does not delete the underlying person.',
    '',
    'A **saved list** is a reusable group of people you can manage once and reference elsewhere.',
    '',
    '## Custom fields',
    '',
    'Beyond standard details (name, company, and so on), a campaign can require **custom fields** — extra values you use to personalize emails, like a recent signup date or plan name.',
    '',
    'If a campaign\u2019s sequence uses a custom field, you must include that value when you add or update a person in that campaign. Otherwise the request is rejected.',
    '',
    '## Tags vs custom fields',
    '',
    '**Lead tags** are account-level and person-keyed (`global_lead_id`). The same tag follows a person across campaigns. Use them for provider, live signals, and operator filters (for example Hunter, Running Meta Ads, Do Not Send).',
    '',
    '`custom_lead_data` is per campaign lead. Use it for sequence personalization tokens such as `{{custom.company}}`.',
    '',
    '**Email verification** is a structured fact on the person (`ok`, `catch_all`, `invalid`, `unknown`, `disposable`), not a tag. Send it on import when you already have a vendor check. Catch-All Domain and Role Account tags are optional operator labels and are not auto-synced from verification.',
    '',
    `To add and manage people, follow the ${guideLink('Lead management', '/guides/lead-management/', linkMode)} guide. Personalization is covered in ${guideLink('Email sequences', '/concepts/sequences/', linkMode)}.`,
  ].join('\n');
}

/** Core Concept: mailboxes / sending inboxes. */
export function buildMailboxesConceptMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'A **mailbox** is one of your connected inboxes — the email account a campaign sends from and receives replies in.',
    '',
    'A campaign sends from one or more mailboxes. Spreading sends across several mailboxes keeps volume per inbox lower, which helps deliverability.',
    '',
    'You pick which mailboxes a campaign uses by their ids. List your connected mailboxes with `GET /v1/mailboxes` to get those ids.',
    '',
    '**Tags** let you group mailboxes (for example, by domain or team) so you can find and assign them more easily.',
    '',
    `You will use a mailbox id in the first step of the ${guideLink('Campaign setup', '/guides/campaign-setup/', linkMode)} guide. Full fields are in the ${referenceLink('API Reference', '/reference/', linkMode)}.`,
  ].join('\n');
}

/** Core Concept: email sequences (steps + personalization), plain language. */
export function buildSequencesConceptMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'A **sequence** is the ordered set of steps a campaign runs for each person. You build it once; every person follows the same path.',
    '',
    '## Step types',
    '',
    '| Step | What it does |',
    '| --- | --- |',
    '| **Email** | Sends an email. You can add A/B variants and Furnace picks between them. |',
    '| **Wait** | Pauses for a set amount of time before the next step. |',
    '| **Branch on reply** | Reads a reply and sends the person down a different path — for example, interested vs not interested. |',
    '| **Send data** | Posts information to another system of yours at that point in the sequence. |',
    '',
    'Steps connect in order, starting from your list of people and moving forward. A person stops when they reach the end of their path or reply in a way that ends the sequence.',
    '',
    '## Personalizing emails',
    '',
    'Use `{{ }}` tokens in a subject or body to drop in each person\u2019s details:',
    '',
    '- `{{first_name}}` — standard details like name, company, or website.',
    '- `{{custom.company}}` — a custom field you defined on the campaign.',
    '',
    'Example:',
    '',
    '```text',
    'Subject: Quick question for {{first_name}}',
    'Body: Hi {{first_name}}, saw {{custom.company}} is hiring and wanted to reach out.',
    '```',
    '',
    'If you reference a token that the campaign does not know about, Furnace flags it so you can add the field or fix the copy before going live.',
    '',
    `Put this into practice in the ${guideLink('Campaign setup', '/guides/campaign-setup/', linkMode)} guide. Exact field names live in the ${referenceLink('API Reference', '/reference/', linkMode)}.`,
  ].join('\n');
}

/** Core Concept: what webhooks are and when they fire. */
export function buildWebhooksConceptMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Webhooks let Furnace tell your systems when something happens — instead of you polling the API for changes.',
    '',
    'You give Furnace an HTTPS URL. When an event occurs, Furnace sends a small JSON message to that URL. Common events include:',
    '',
    '- an email was sent',
    '- a reply arrived',
    '- a reply was categorized (for example, interested)',
    '- a bounce was detected',
    '- people finished importing in bulk',
    '',
    'Each message says what happened and includes the relevant details, so you can update a CRM, trigger a workflow, or log activity.',
    '',
    `To set up a URL, verify messages, and see example payloads, follow the ${guideLink('Webhook integration', '/guides/webhook-integration/', linkMode)} guide.`,
  ].join('\n');
}
