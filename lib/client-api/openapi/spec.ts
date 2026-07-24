import {
  CLIENT_API_OPENAPI_VERSION,
  CLIENT_API_TITLE,
  CLIENT_API_VERSION,
} from './constants.js';
import { buildClientApiPaths } from './paths.js';
import { buildClientApiComponents } from './schemas.js';

const apiTags = [
  {
    name: 'Campaigns',
    description: 'Read and mutate campaigns that belong to the authenticated account.',
  },
  {
    name: 'Flow',
    description: 'Read, validate, and update campaign flow graphs.',
  },
  {
    name: 'Leads',
    description: 'Manage campaign leads, including single-row upserts and bulk imports.',
  },
  {
    name: 'Lead fields',
    description: 'Inspect and extend required lead-field mappings derived from the campaign flow.',
  },
  {
    name: 'Jobs',
    description: 'Create and poll asynchronous bulk jobs (import, add/remove, pause/resume).',
  },
  {
    name: 'People',
    description: 'Account-scoped people explorer and profile updates.',
  },
  {
    name: 'Lead lists',
    description: 'Saved lead lists and list membership.',
  },
  {
    name: 'Mailboxes',
    description: 'Read account mailboxes, manage mailbox tags, and keep secret password fields out of responses.',
  },
  {
    name: 'Inbox',
    description: 'List and triage inbox threads, read messages, send replies and forwards, manage message jobs, out-of-office state, lead replacement, and thread tags.',
  },
  {
    name: 'Block list',
    description: 'List, add, and remove blocked email or domain values.',
  },
  {
    name: 'Stats',
    description: 'Read daily and aggregate campaign performance statistics.',
  },
  {
    name: 'Webhooks',
    description: 'Read and update account webhook URL, signing secret, and enabled events.',
  },
  {
    name: 'API keys',
    description: 'List, create, and revoke account API keys. Create returns the secret once.',
  },
  {
    name: 'Meta',
    description: 'Service metadata endpoints.',
  },
];

function buildOpenApiDescription(baseUrl: string) {
  return [
    'Account-scoped REST API for campaigns, leads, people, saved lists, inbox, mailboxes, mailbox tags, stats, and block list.',
    '',
    `Human-readable guides and API reference: **${baseUrl.replace(/\/$/, '')}/docs**`,
  ].join('\n');
}

export function buildClientApiOpenApiSpec(baseUrl: string) {
  return {
    openapi: CLIENT_API_OPENAPI_VERSION,
    info: {
      title: CLIENT_API_TITLE,
      version: CLIENT_API_VERSION,
      description: buildOpenApiDescription(baseUrl),
    },
    servers: [{ url: baseUrl }],
    tags: apiTags,
    components: buildClientApiComponents(),
    security: [{ bearerAuth: [] }],
    paths: buildClientApiPaths(),
  };
}
