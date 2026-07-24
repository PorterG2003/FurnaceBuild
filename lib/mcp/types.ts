export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type JsonSchema = Record<string, unknown>;

export type McpToolDefinition = {
  /** OpenAPI operationId — also the MCP tool name. */
  operationId: string;
  method: HttpMethod;
  /** Path template with `{param}` placeholders, e.g. `/v1/campaigns/{id}`. */
  pathTemplate: string;
  summary?: string;
  description?: string;
  /** JSON Schema object for tool arguments (path + query + body fields). */
  inputSchema: JsonSchema;
  pathParamNames: string[];
  queryParamNames: string[];
  hasRequestBody: boolean;
};

export type ClientApiProxyRequest = {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  authorization: string;
  /** User-session account selector; ignored by Client API for f_ keys. */
  accountId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export type ClientApiProxySuccess = {
  ok: true;
  status: number;
  data: unknown;
};

export type ClientApiProxyFailure = {
  ok: false;
  status: number;
  error: {
    message: string;
    status: number;
    bodySnippet?: string;
    code?: string;
  };
};

export type ClientApiProxyResult = ClientApiProxySuccess | ClientApiProxyFailure;
