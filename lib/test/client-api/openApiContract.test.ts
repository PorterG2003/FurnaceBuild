import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientApiOpenApiSpec } from '../../client-api/openapi/spec.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

test('client api openapi spec documents auth, schemas, and request contracts', () => {
  const spec = buildClientApiOpenApiSpec('https://api.example.com') as {
    info: { description: string };
    tags: Array<{ name: string; description: string }>;
    components: {
      schemas: Record<string, unknown>;
      parameters: Record<string, unknown>;
      responses: Record<string, unknown>;
    };
    paths: Record<string, Record<string, { operationId?: string; tags?: string[]; responses?: Record<string, unknown>; requestBody?: unknown }>>;
  };

  assert.match(spec.info.description, /Authentication/);
  assert.match(spec.info.description, /X-RateLimit-Limit/);
  assert.match(spec.info.description, /Idempotency-Key/);
  assert.match(spec.info.description, /Smartlead campaigns are read-only/);

  assert.ok(spec.tags.some((tag) => tag.name === 'Campaigns'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Inbox'));

  assert.ok('LeadCreate' in spec.components.schemas);
  assert.ok('CampaignListResponse' in spec.components.schemas);
  assert.ok('Error' in spec.components.schemas);
  assert.ok('IdempotencyKey' in spec.components.parameters);
  assert.ok('UnauthorizedError' in spec.components.responses);

  const expectedOperations: Record<string, string[]> = {
    '/health': ['get'],
    '/openapi.json': ['get'],
    '/docs': ['get'],
    '/v1/campaigns': ['get'],
    '/v1/campaigns/{id}': ['get', 'patch', 'delete'],
    '/v1/campaigns/{id}/pause': ['post'],
    '/v1/campaigns/{id}/stop': ['post'],
    '/v1/campaigns/{id}/resume': ['post'],
    '/v1/campaigns/{id}/flow': ['get'],
    '/v1/campaigns/{id}/lead-fields': ['get', 'post'],
    '/v1/campaigns/{id}/leads': ['get', 'post'],
    '/v1/campaigns/{id}/leads/{leadId}': ['get', 'patch', 'delete'],
    '/v1/campaigns/{id}/leads/bulk': ['post'],
    '/v1/campaigns/{id}/leads/bulk/async': ['post'],
    '/v1/jobs/{id}': ['get'],
    '/v1/mailboxes': ['get'],
    '/v1/mailboxes/{id}': ['get'],
    '/v1/threads': ['get'],
    '/v1/threads/{id}': ['get'],
    '/v1/threads/{id}/messages': ['get'],
    '/v1/threads/{id}/reply': ['post'],
    '/v1/block-list': ['get', 'post'],
    '/v1/block-list/{id}': ['delete'],
    '/v1/campaigns/{id}/stats': ['get'],
  };

  for (const [path, methods] of Object.entries(expectedOperations)) {
    assert.ok(path in spec.paths, `missing path ${path}`);
    for (const method of methods) {
      const operation = spec.paths[path]?.[method];
      assert.ok(operation, `missing ${method.toUpperCase()} ${path}`);
      assert.ok(operation.operationId, `missing operationId for ${method.toUpperCase()} ${path}`);
      assert.ok(operation.tags?.length, `missing tags for ${method.toUpperCase()} ${path}`);
      assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `missing responses for ${method.toUpperCase()} ${path}`);

      const isMutating = method === 'post' || method === 'patch';
      if (isMutating && path !== '/v1/campaigns/{id}/pause' && path !== '/v1/campaigns/{id}/stop' && path !== '/v1/campaigns/{id}/resume') {
        assert.ok(operation.requestBody, `missing requestBody for ${method.toUpperCase()} ${path}`);
      }
    }
  }
});

test('client api exposes a public openapi contract and health endpoint', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('contract'),
  });

  try {
    const health = await harness.request('/health');
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { status: string; db: string };
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.db, 'ok');

    const openapi = await harness.request('/openapi.json');
    assert.equal(openapi.status, 200);
    const spec = await openapi.json() as {
      openapi: string;
      paths: Record<string, Record<string, { requestBody?: unknown; responses?: Record<string, unknown> }>>;
      info: { title: string; description: string };
      components: { schemas: Record<string, unknown> };
    };
    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.info.title, 'Furnace Client API');
    assert.ok('/v1/campaigns' in spec.paths);
    assert.ok('/v1/campaigns/{id}/leads/bulk/async' in spec.paths);
    assert.ok('/v1/jobs/{id}' in spec.paths);
    assert.match(spec.info.description, /Rate Limits/);
    assert.ok('LeadCreate' in spec.components.schemas);
    assert.ok(spec.paths['/v1/campaigns/{id}/leads'].post?.requestBody);
    assert.ok(spec.paths['/v1/threads/{id}/reply'].post?.responses?.['202']);
  } finally {
    await harness.cleanup();
  }
});
