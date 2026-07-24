import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMcpToolRegistry,
  listAuthenticatedOpenApiOperationIds,
  fillPathTemplate,
  splitToolArgs,
} from './registry.js';
import { SYNTHETIC_MCP_TOOL_NAMES } from './accountsTools.js';
import { injectAccountIdIntoInputSchema } from './accountSelection.js';
import { buildClientApiOpenApiSpec } from '../client-api/openapi/spec.js';
import { resolveJsonRefs } from './jsonSchema.js';
import type { HttpMethod } from './types.js';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

function openApiOperationIdsWithIdempotencyKey(): Set<string> {
  const raw = buildClientApiOpenApiSpec('https://api.getfurnace.io');
  const spec = resolveJsonRefs(raw) as {
    paths?: Record<string, Record<string, { operationId?: string; parameters?: Array<{ name?: string; in?: string }> }>>;
  };
  const ids = new Set<string>();
  for (const pathItem of Object.values(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!(HTTP_METHODS as string[]).includes(method)) continue;
      if (!operation?.operationId) continue;
      const hasIdem = (operation.parameters ?? []).some(
        (p) => p.in === 'header' && p.name === 'Idempotency-Key',
      );
      if (hasIdem) ids.add(operation.operationId);
    }
  }
  return ids;
}

test('registry parity: every authenticated OpenAPI operationId has a tool', () => {
  const operationIds = listAuthenticatedOpenApiOperationIds();
  const tools = buildMcpToolRegistry();
  const toolIds = tools.map((t) => t.operationId).sort();

  assert.deepEqual(toolIds, operationIds);
  assert.ok(toolIds.includes('listCampaigns'));
  assert.ok(toolIds.includes('getCampaign'));
  assert.ok(toolIds.includes('listThreads'));
  assert.ok(!toolIds.includes('getOpenApiDocument'));
  assert.ok(tools.length >= 60);
});

test('registry tools include method and path template', () => {
  const tools = buildMcpToolRegistry();
  const getCampaign = tools.find((t) => t.operationId === 'getCampaign');
  assert.ok(getCampaign);
  assert.equal(getCampaign?.method, 'get');
  assert.equal(getCampaign?.pathTemplate, '/v1/campaigns/{id}');
  assert.ok(getCampaign?.pathParamNames.includes('id'));
  assert.equal(getCampaign?.inputSchema.type, 'object');
});

test('idempotency_key is advertised iff OpenAPI declares Idempotency-Key', () => {
  const expected = openApiOperationIdsWithIdempotencyKey();
  const tools = buildMcpToolRegistry();

  assert.ok(expected.has('createCampaign'));
  assert.ok(expected.has('createOrUpsertLead'));
  assert.ok(expected.has('bulkSyncLeads'));

  for (const tool of tools) {
    const hasArg = Boolean(
      tool.inputSchema.properties &&
        typeof tool.inputSchema.properties === 'object' &&
        'idempotency_key' in (tool.inputSchema.properties as object),
    );
    assert.equal(
      hasArg,
      expected.has(tool.operationId),
      `${tool.operationId}: idempotency_key schema=${hasArg}, openapi=${expected.has(tool.operationId)}`,
    );
  }

  const pause = tools.find((t) => t.operationId === 'pauseCampaign');
  const getCampaign = tools.find((t) => t.operationId === 'getCampaign');
  const list = tools.find((t) => t.operationId === 'listCampaigns');
  const webhooks = tools.find((t) => t.operationId === 'updateWebhookSettings');
  for (const tool of [pause, getCampaign, list, webhooks]) {
    assert.ok(tool);
    assert.equal(
      Boolean((tool!.inputSchema.properties as Record<string, unknown> | undefined)?.idempotency_key),
      false,
    );
  }
});

test('fillPathTemplate and splitToolArgs map args to request parts', () => {
  const tools = buildMcpToolRegistry();
  const listCampaigns = tools.find((t) => t.operationId === 'listCampaigns');
  assert.ok(listCampaigns);

  const path = fillPathTemplate('/v1/campaigns/{id}', { id: 'abc-123' }, ['id']);
  assert.equal(path, '/v1/campaigns/abc-123');

  const encoded = fillPathTemplate(
    '/v1/campaigns/{id}',
    { id: '../../../etc/passwd' },
    ['id'],
  );
  assert.equal(encoded, '/v1/campaigns/..%2F..%2F..%2Fetc%2Fpasswd');

  const create = tools.find((t) => t.operationId === 'createCampaign');
  assert.ok(create);
  assert.ok((create!.inputSchema.properties as Record<string, unknown>)?.idempotency_key);
  const split = splitToolArgs(create!, {
    name: 'Hello',
    mailbox_ids: ['m1'],
    idempotency_key: 'k1',
  });
  assert.equal(split.path, '/v1/campaigns');
  assert.equal(split.idempotencyKey, 'k1');
  assert.deepEqual(split.body, { name: 'Hello', mailbox_ids: ['m1'] });
});

test('synthetic MCP tool names are not OpenAPI operationIds', () => {
  const operationIds = new Set(listAuthenticatedOpenApiOperationIds());
  for (const name of SYNTHETIC_MCP_TOOL_NAMES) {
    assert.equal(
      operationIds.has(name),
      false,
      `${name} should not appear as an OpenAPI operationId`,
    );
  }
  assert.ok(SYNTHETIC_MCP_TOOL_NAMES.includes('listAccounts'));
  assert.ok(SYNTHETIC_MCP_TOOL_NAMES.includes('getAccount'));
});

test('injectAccountIdIntoInputSchema adds account_id without clobbering existing', () => {
  const original = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      limit: { type: 'integer' },
    },
    required: ['id'],
  };
  const injected = injectAccountIdIntoInputSchema(original);
  const props = injected.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.id?.type, 'string');
  assert.equal(props.limit?.type, 'integer');
  assert.equal(props.account_id?.type, 'string');
  assert.equal(props.account_id?.format, 'uuid');
  assert.deepEqual(injected.required, ['id']);
  // Original object not mutated
  assert.equal(
    (original.properties as Record<string, unknown>).account_id,
    undefined,
  );
});
