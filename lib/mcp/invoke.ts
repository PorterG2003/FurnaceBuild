import { formatProxyFailureForTool, proxyClientApi, type ClientApiProxyOptions } from './proxy.js';
import { splitToolArgs, type BuildRegistryOptions, buildMcpToolRegistry } from './registry.js';
import type { McpToolDefinition } from './types.js';

export type ToolCallContext = {
  authorization: string;
  proxy: ClientApiProxyOptions;
  /** When set, forwarded as X-Furnace-Account-Id (user sessions). */
  accountId?: string;
  allowedAccountIds?: string[];
  userId?: string;
  authKind?: 'api_key' | 'oauth' | 'user';
};

export type ToolCallResult = {
  isError: boolean;
  text: string;
  data?: unknown;
};

export function createToolIndex(
  options?: BuildRegistryOptions,
): Map<string, McpToolDefinition> {
  const tools = buildMcpToolRegistry(options);
  return new Map(tools.map((tool) => [tool.operationId, tool]));
}

export async function invokeMcpTool(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
  context: ToolCallContext,
): Promise<ToolCallResult> {
  try {
    let accountId = context.accountId;
    let forwardedArgs = args;

    if (context.authKind === 'user' && context.allowedAccountIds) {
      const { resolveAccountSelection } = await import('./accountSelection.js');
      const selection = resolveAccountSelection({
        args,
        allowedAccountIds: context.allowedAccountIds,
      });
      if (!selection.ok) {
        return { isError: true, text: selection.message };
      }
      accountId = selection.accountId;
      forwardedArgs = selection.forwardedArgs;
    }

    const { path, query, body, idempotencyKey } = splitToolArgs(tool, forwardedArgs);
    const result = await proxyClientApi(context.proxy, {
      method: tool.method,
      path,
      query,
      body,
      authorization: context.authorization,
      accountId,
      idempotencyKey,
    });

    if (!result.ok) {
      return {
        isError: true,
        text: formatProxyFailureForTool(result),
      };
    }

    return {
      isError: false,
      text: JSON.stringify(result.data, null, 2),
      data: result.data,
    };
  } catch (err) {
    return {
      isError: true,
      text: err instanceof Error ? err.message : 'Tool invocation failed',
    };
  }
}
