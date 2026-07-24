import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Furnace MCP — hosted Streamable HTTP MCP proxy over the Client API.
 *
 * Environment:
 * - CLIENT_API_BASE_URL: target Client API origin (injected in amplify/backend.ts)
 * - MCP_BASE_URL: public MCP origin for OAuth metadata (when custom domain set)
 * - MCP_SERVER_NAME: MCP serverInfo.name (`furnace` / `furnace-dev`); icons come from Client API docs assets
 * - SUPABASE_URL: injected in amplify/backend.ts
 * - SUPABASE_SECRET_KEY: Amplify secret (OAuth token persistence / user validation)
 * - MCP_OAUTH_SIGNING_SECRET: optional; falls back to SUPABASE_SECRET_KEY for HMAC tokens
 * - MCP_APP_ORIGIN: Furnace app origin for OAuth consent redirects
 */
export const mcp = defineFunction({
  name: 'mcp',
  entry: './handler.ts',
  memoryMB: 1024,
  timeoutSeconds: 60,
  environment: {
    SUPABASE_SECRET_KEY: secret('SUPABASE_SECRET_KEY'),
  },
});
