import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  buildMcpToolRegistry,
  createToolIndex,
  invokeMcpTool,
} from '../../../lib/mcp/index.js';
import { resolveMcpAuthorization, type McpAuthSuccess } from '../../../lib/mcp/auth.js';
import { injectAccountIdIntoInputSchema } from '../../../lib/mcp/accountSelection.js';
import {
  GET_ACCOUNT_TOOL,
  LIST_ACCOUNTS_TOOL,
  getAccountForSession,
  listAccountsForSession,
} from '../../../lib/mcp/accountsTools.js';
import {
  buildProtectedResourceMetadata,
  handleAuthorize,
  handleOAuthComplete,
  handleRegisterClient,
  handleRevoke,
  handleToken,
  oauthAuthorizationServerMetadata,
} from '../../../lib/mcp/oauth.js';
import { FAVICON_ICO_BASE64, LOGO_MARK_SVG } from './brandAssets.js';

const FAVICON_CACHE_CONTROL = 'public, max-age=86400';

function getClientApiBaseUrl(): string {
  const fromEnv = process.env.CLIENT_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://api.getfurnace.io';
}

function getMcpBaseUrl(requestUrl: string): string {
  const fromEnv = process.env.MCP_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  try {
    return new URL(requestUrl).origin;
  } catch {
    return 'https://mcp.getfurnace.io';
  }
}

/** Display name in MCP clients (Cursor). Distinct for mcp-dev vs prod. */
export function getMcpServerName(): string {
  const fromEnv = process.env.MCP_SERVER_NAME?.trim();
  if (fromEnv) return fromEnv;
  const base =
    process.env.MCP_BASE_URL?.trim() ||
    process.env.MCP_DOMAIN_NAME?.trim() ||
    '';
  if (/mcp-dev/i.test(base)) return 'furnace-dev';
  return 'furnace';
}

/** Branding metadata for MCP clients (SEP-973 icons / websiteUrl). */
export function getMcpServerInfo() {
  const docsBase = `${getClientApiBaseUrl()}/docs`;
  const mcpBase =
    process.env.MCP_BASE_URL?.trim().replace(/\/$/, '') ||
    process.env.MCP_DOMAIN_NAME?.trim().replace(/\/$/, '') ||
    null;
  const mcpOrigin = mcpBase
    ? mcpBase.startsWith('http')
      ? mcpBase
      : `https://${mcpBase}`
    : null;
  return {
    name: getMcpServerName(),
    version: '1.0.0',
    websiteUrl: 'https://getfurnace.io',
    // Prefer PNG; omit `sizes` — some Cursor builds rejected sizes as array.
    icons: [
      {
        src: `${docsBase}/favicon-96x96.png`,
        mimeType: 'image/png' as const,
      },
      {
        src: mcpOrigin ? `${mcpOrigin}/favicon.svg` : `${docsBase}/logo-mark.svg`,
        mimeType: 'image/svg+xml' as const,
      },
      ...(mcpOrigin
        ? [
            {
              src: `${mcpOrigin}/favicon.ico`,
              mimeType: 'image/x-icon' as const,
            },
          ]
        : []),
    ],
  };
}

function createConfiguredMcpServer(auth: McpAuthSuccess): McpServer {
  const server = new McpServer(getMcpServerInfo(), {
    capabilities: { tools: {} },
  });

  const baseUrl = getClientApiBaseUrl();
  const tools = buildMcpToolRegistry({ baseUrl }).map((tool) => ({
    ...tool,
    inputSchema: injectAccountIdIntoInputSchema(tool.inputSchema),
  }));
  const index = createToolIndex({ baseUrl });

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: LIST_ACCOUNTS_TOOL.name,
        description: LIST_ACCOUNTS_TOOL.description,
        inputSchema: LIST_ACCOUNTS_TOOL.inputSchema,
      },
      {
        name: GET_ACCOUNT_TOOL.name,
        description: GET_ACCOUNT_TOOL.description,
        inputSchema: GET_ACCOUNT_TOOL.inputSchema,
      },
      ...tools.map((tool) => ({
        name: tool.operationId,
        description: tool.description || tool.summary || tool.operationId,
        inputSchema: tool.inputSchema,
      })),
    ],
  }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === LIST_ACCOUNTS_TOOL.name) {
      if (auth.authKind !== 'user' || !auth.userId || !auth.allowedAccountIds) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'listAccounts requires a user-scoped MCP session (OAuth). API keys are account-pinned.',
            },
          ],
        };
      }
      const accounts = await listAccountsForSession({
        userId: auth.userId,
        allowedAccountIds: auth.allowedAccountIds,
      });
      return {
        isError: false,
        content: [{ type: 'text' as const, text: JSON.stringify({ accounts }, null, 2) }],
      };
    }

    if (name === GET_ACCOUNT_TOOL.name) {
      if (auth.authKind !== 'user' || !auth.userId || !auth.allowedAccountIds) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'getAccount requires a user-scoped MCP session (OAuth). API keys are account-pinned.',
            },
          ],
        };
      }
      const accountId =
        typeof args.account_id === 'string' ? args.account_id.trim() : '';
      if (!accountId) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'account_id is required' }],
        };
      }
      const result = await getAccountForSession({
        userId: auth.userId,
        allowedAccountIds: auth.allowedAccountIds,
        accountId,
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: result.message }],
        };
      }
      return {
        isError: false,
        content: [{ type: 'text' as const, text: JSON.stringify(result.account, null, 2) }],
      };
    }

    const tool = index.get(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      };
    }

    const result = await invokeMcpTool(tool, args, {
      authorization: auth.authorizationHeader,
      proxy: { baseUrl },
      accountId: auth.accountId,
      allowedAccountIds: auth.allowedAccountIds,
      userId: auth.userId,
      authKind: auth.authKind,
    });
    console.log(
      JSON.stringify({
        service: 'mcp',
        operationId: name,
        // Prefer resolved tool account (from args); auth.accountId is only set for API-key sessions.
        account_id: (args.account_id as string | undefined) ?? auth.accountId ?? null,
        user_id: auth.userId ?? null,
        auth_kind: auth.authKind,
        is_error: result.isError,
      }),
    );
    return {
      isError: result.isError,
      content: [{ type: 'text' as const, text: result.text }],
    };
  });

  return server;
}

export const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Mcp-Session-Id',
      'Last-Event-ID',
      'MCP-Protocol-Version',
    ],
    exposeHeaders: ['Mcp-Session-Id'],
  }),
);

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    clientApiBaseUrl: getClientApiBaseUrl(),
  }),
);

app.get('/favicon.ico', (c) => {
  const body = Buffer.from(FAVICON_ICO_BASE64, 'base64');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/x-icon',
      'Cache-Control': FAVICON_CACHE_CONTROL,
      'Content-Length': String(body.byteLength),
    },
  });
});

app.get('/favicon.svg', () =>
  new Response(LOGO_MARK_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': FAVICON_CACHE_CONTROL,
    },
  }),
);

app.get('/.well-known/oauth-protected-resource', (c) => {
  const base = getMcpBaseUrl(c.req.url);
  return c.json(buildProtectedResourceMetadata(base));
});

app.get('/.well-known/oauth-authorization-server', (c) => {
  const base = getMcpBaseUrl(c.req.url);
  return c.json(oauthAuthorizationServerMetadata(base));
});

app.get('/oauth/authorize', (c) => handleAuthorize(c));
app.post('/oauth/token', (c) => handleToken(c));
app.post('/oauth/register', (c) => handleRegisterClient(c));
app.post('/oauth/complete', (c) => handleOAuthComplete(c));
app.post('/oauth/revoke', (c) => handleRevoke(c));

app.all('/mcp', async (c) => {
  const auth = await resolveMcpAuthorization(c.req.header('Authorization'));
  if (!auth.ok) {
    const wwwAuthenticate = `Bearer realm="furnace-mcp", resource_metadata="${getMcpBaseUrl(c.req.url)}/.well-known/oauth-protected-resource"`;
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: auth.message },
        id: null,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': wwwAuthenticate,
          'X-MCP-WWW-Authenticate': wwwAuthenticate,
        },
      },
    );
  }

  const server = createConfiguredMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  let parsedBody: unknown;
  if (c.req.method === 'POST') {
    try {
      parsedBody = await c.req.json();
    } catch {
      parsedBody = undefined;
    }
  }

  return transport.handleRequest(c.req.raw, { parsedBody });
});
