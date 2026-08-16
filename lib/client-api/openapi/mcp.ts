import { API_KEY_PREFIX } from './constants.js';
import { guideLink, referenceLink, type DocLinkMode } from './docLinks.js';

/** Public hosted MCP endpoint customers connect their AI clients to. */
export const MCP_SERVER_URL = 'https://mcp.getfurnace.io/mcp';

/** MCP guide: what the hosted server is, how to connect with OAuth, and the API-key fallback. */
export function buildMcpGuideMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Furnace runs a hosted MCP (Model Context Protocol) server so AI clients like Cursor, Claude, and ChatGPT can work with your account directly \u2014 create campaigns, add people, read replies, and more. The tools mirror the Client API and update automatically.',
    '',
    '## Server URL',
    '',
    'Add this as a remote (HTTP) MCP server in your client:',
    '',
    '```',
    MCP_SERVER_URL,
    '```',
    '',
    'You can also copy this from **Account Settings \u2192 MCP** in Furnace.',
    '',
    '## Connect with OAuth',
    '',
    '1. In your MCP client, add a new **remote / HTTP** MCP server using the URL above.',
    '2. When prompted, sign in to Furnace and click **Approve**.',
    '3. Your client receives an access token automatically \u2014 there is no API key to paste.',
    '',
    'Server updates apply on your next session without any change to your MCP config.',
    '',
    '## What you get',
    '',
    'Tools mirror the Furnace Client API \u2014 campaigns, flows, leads, inbox threads, webhooks, API keys, and mailbox connect sessions. ' +
      `The ${referenceLink('API Reference', '/reference/', linkMode)} documents the underlying endpoints and objects.`,
    '',
    'When adding people, tag by **name** (`Hunter`, `Running Meta Ads`) rather than inventing UUIDs. Send `email_verification` only when you already have a verifier result; never guess `ok`. Tags are person-level; `custom_lead_data` is campaign-level personalization.',
    '',
    '## Advanced: API key',
    '',
    'For scripts or clients that do not support OAuth, you can authenticate with an API key instead:',
    '',
    '```http',
    `Authorization: Bearer ${API_KEY_PREFIX}your_key_here`,
    '```',
    '',
    `Create a key under **Account Settings \u2192 API keys** \u2014 see ${guideLink('Authentication', '/guides/authentication/', linkMode)}. Prefer OAuth for interactive MCP clients.`,
  ].join('\n');
}
