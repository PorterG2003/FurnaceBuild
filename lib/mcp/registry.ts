import { buildClientApiOpenApiSpec } from '../client-api/openapi/spec.js';
import { asObjectSchema, resolveJsonRefs } from './jsonSchema.js';
import { sanitizeToolInputSchema } from './sanitizeToolInputSchema.js';
import type { HttpMethod, JsonSchema, McpToolDefinition } from './types.js';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

/** Public meta ops that are optional as MCP tools. */
export const OPTIONAL_META_OPERATION_IDS = new Set(['getOpenApiDocument']);

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: unknown;
    description?: string;
    $ref?: string;
  }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: unknown }>;
  };
};

type OpenApiSpec = {
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>> & Record<string, unknown>>;
  components?: unknown;
};

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as string[]).includes(value);
}

function mergeDescription(summary?: string, description?: string): string | undefined {
  if (summary && description) {
    if (description.startsWith(summary)) return description;
    return `${summary}\n\n${description}`;
  }
  return description || summary;
}

function parameterToProperty(
  param: NonNullable<OpenApiOperation['parameters']>[number],
): { name: string; schema: JsonSchema; required: boolean; in: string } | null {
  if (param.$ref) {
    // Should already be resolved on the operation; skip unresolved
    return null;
  }
  const name = param.name;
  if (!name) return null;
  const schema = asObjectSchema(
    param.schema && typeof param.schema === 'object'
      ? { ...(param.schema as object), ...(param.description ? { description: param.description } : {}) }
      : { type: 'string', ...(param.description ? { description: param.description } : {}) },
  );
  return {
    name,
    schema,
    required: Boolean(param.required),
    in: param.in,
  };
}

function buildInputSchema(op: OpenApiOperation): {
  inputSchema: JsonSchema;
  pathParamNames: string[];
  queryParamNames: string[];
  hasRequestBody: boolean;
} {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const pathParamNames: string[] = [];
  const queryParamNames: string[] = [];

  let supportsIdempotencyKey = false;

  for (const param of op.parameters ?? []) {
    const mapped = parameterToProperty(param);
    if (!mapped) continue;
    if (mapped.in === 'path') {
      pathParamNames.push(mapped.name);
      properties[mapped.name] = mapped.schema;
      required.push(mapped.name);
    } else if (mapped.in === 'query') {
      queryParamNames.push(mapped.name);
      properties[mapped.name] = mapped.schema;
      if (mapped.required) required.push(mapped.name);
    } else if (mapped.in === 'header' && mapped.name === 'Idempotency-Key') {
      supportsIdempotencyKey = true;
    }
  }

  let hasRequestBody = false;
  const jsonBody = op.requestBody?.content?.['application/json']?.schema;
  if (jsonBody) {
    hasRequestBody = true;
    const bodySchema = asObjectSchema(jsonBody);
    // Prefer flattening object body fields into the tool args when possible
    if (bodySchema.type === 'object' || bodySchema.properties) {
      const bodyProps = (bodySchema.properties ?? {}) as Record<string, JsonSchema>;
      for (const [key, schema] of Object.entries(bodyProps)) {
        if (!(key in properties)) {
          properties[key] = schema;
        }
      }
      const bodyRequired = Array.isArray(bodySchema.required)
        ? (bodySchema.required as string[])
        : [];
      for (const key of bodyRequired) {
        if (!required.includes(key)) required.push(key);
      }
    } else {
      properties.body = bodySchema;
      if (op.requestBody?.required) required.push('body');
    }
  }

  // Only advertise when OpenAPI declares Idempotency-Key on the operation.
  if (supportsIdempotencyKey) {
    properties.idempotency_key = {
      type: 'string',
      description:
        'Optional Idempotency-Key header value forwarded to the Client API for this operation.',
    };
  }

  const inputSchema: JsonSchema = sanitizeToolInputSchema({
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  });

  return { inputSchema, pathParamNames, queryParamNames, hasRequestBody };
}

export type BuildRegistryOptions = {
  baseUrl?: string;
  /** When true, include getOpenApiDocument. Default false. */
  includeOptionalMeta?: boolean;
};

/**
 * Build MCP tool definitions from the live Client API OpenAPI builders.
 */
export function buildMcpToolRegistry(options: BuildRegistryOptions = {}): McpToolDefinition[] {
  const rawSpec = buildClientApiOpenApiSpec(options.baseUrl ?? 'https://api.getfurnace.io');
  const spec = resolveJsonRefs(rawSpec) as OpenApiSpec;
  const tools: McpToolDefinition[] = [];

  for (const [pathTemplate, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;
      const op = operation as OpenApiOperation;
      if (!op?.operationId) continue;
      if (!options.includeOptionalMeta && OPTIONAL_META_OPERATION_IDS.has(op.operationId)) {
        continue;
      }
      // Skip unauthenticated health? Keep getHealth — useful for agents.
      const { inputSchema, pathParamNames, queryParamNames, hasRequestBody } = buildInputSchema(op);
      tools.push({
        operationId: op.operationId,
        method,
        pathTemplate,
        summary: op.summary,
        description: mergeDescription(op.summary, op.description),
        inputSchema,
        pathParamNames,
        queryParamNames,
        hasRequestBody,
      });
    }
  }

  tools.sort((a, b) => a.operationId.localeCompare(b.operationId));
  return tools;
}

export function listAuthenticatedOpenApiOperationIds(
  options: BuildRegistryOptions = {},
): string[] {
  const rawSpec = buildClientApiOpenApiSpec(
    options.baseUrl ?? 'https://api.getfurnace.io',
  ) as unknown as OpenApiSpec;
  const ids: string[] = [];
  for (const pathItem of Object.values(rawSpec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;
      const op = operation as OpenApiOperation;
      if (!op?.operationId) continue;
      if (!options.includeOptionalMeta && OPTIONAL_META_OPERATION_IDS.has(op.operationId)) {
        continue;
      }
      ids.push(op.operationId);
    }
  }
  return ids.sort();
}

export function fillPathTemplate(
  pathTemplate: string,
  args: Record<string, unknown>,
  pathParamNames: string[],
): string {
  let path = pathTemplate;
  for (const name of pathParamNames) {
    const value = args[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required path parameter: ${name}`);
    }
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  if (path.includes('{')) {
    throw new Error(`Unresolved path parameters in ${path}`);
  }
  return path;
}

export function splitToolArgs(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
): {
  path: string;
  query: Record<string, string | number | boolean>;
  body: unknown;
  idempotencyKey?: string;
} {
  const path = fillPathTemplate(tool.pathTemplate, args, tool.pathParamNames);
  const query: Record<string, string | number | boolean> = {};
  for (const name of tool.queryParamNames) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      query[name] = value;
    } else {
      query[name] = String(value);
    }
  }

  const idempotencyKey =
    typeof args.idempotency_key === 'string' ? args.idempotency_key : undefined;

  const reserved = new Set([
    ...tool.pathParamNames,
    ...tool.queryParamNames,
    'idempotency_key',
  ]);

  let body: unknown;
  if (tool.hasRequestBody) {
    if ('body' in args && args.body !== undefined) {
      body = args.body;
    } else {
      const bodyObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(args)) {
        if (reserved.has(key)) continue;
        bodyObj[key] = value;
      }
      body = bodyObj;
    }
  }

  return { path, query, body, idempotencyKey };
}
