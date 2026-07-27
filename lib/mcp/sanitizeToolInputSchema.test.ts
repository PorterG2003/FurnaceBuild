import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertToolInputSchemaCompatible,
  lintToolInputSchema,
  sanitizeToolInputSchema,
} from './sanitizeToolInputSchema.js';

test('strip-openapi-keys removes nullable and example', () => {
  const sanitized = sanitizeToolInputSchema({
    type: 'object',
    properties: {
      name: { type: 'string', nullable: true, example: 'Ada' },
      tags: { type: 'array', items: { type: 'string' }, examples: [['a']] },
    },
  });

  const name = (sanitized.properties as Record<string, Record<string, unknown>>).name;
  const tags = (sanitized.properties as Record<string, Record<string, unknown>>).tags;
  assert.equal(name?.type, 'string');
  assert.equal('nullable' in (name ?? {}), false);
  assert.equal('example' in (name ?? {}), false);
  assert.equal('examples' in (tags ?? {}), false);
  assert.equal(lintToolInputSchema(sanitized).length, 0);
});

test('normalize-type-unions collapses string|null to string', () => {
  const sanitized = sanitizeToolInputSchema({
    type: 'object',
    properties: {
      campaign_id: { type: ['string', 'null'], format: 'uuid' },
    },
  });
  const prop = (sanitized.properties as Record<string, Record<string, unknown>>).campaign_id;
  assert.equal(prop?.type, 'string');
  assert.equal(prop?.format, 'uuid');
});

test('unwrap-trivial-allOf merges single branch into parent', () => {
  const sanitized = sanitizeToolInputSchema({
    type: 'object',
    properties: {
      schedule: {
        allOf: [
          {
            type: 'object',
            properties: {
              timezone: { type: 'string' },
              start_hour: { type: 'integer' },
            },
            required: ['timezone', 'start_hour'],
            additionalProperties: false,
          },
        ],
        nullable: true,
        description: 'Send window. null means 24/7.',
      },
    },
  });

  const schedule = (sanitized.properties as Record<string, Record<string, unknown>>).schedule;
  assert.equal(schedule?.type, 'object');
  assert.equal('allOf' in (schedule ?? {}), false);
  assert.equal('nullable' in (schedule ?? {}), false);
  assert.ok((schedule?.properties as Record<string, unknown>)?.timezone);
  assert.deepEqual(schedule?.required, ['timezone', 'start_hour']);
  assert.match(String(schedule?.description), /Send window/);
});

test('collapse-combinators merges object oneOf branches', () => {
  const sanitized = sanitizeToolInputSchema({
    type: 'object',
    properties: {
      data: {
        description: 'Type-specific node configuration.',
        oneOf: [
          {
            type: 'object',
            properties: { label: { type: 'string' }, customFieldKeys: { type: 'array' } },
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { label: { type: 'string' }, variants: { type: 'array' } },
            required: ['variants'],
            additionalProperties: false,
          },
        ],
      },
    },
  });

  const data = (sanitized.properties as Record<string, Record<string, unknown>>).data;
  assert.equal(data?.type, 'object');
  assert.equal('oneOf' in (data ?? {}), false);
  const props = data?.properties as Record<string, unknown>;
  assert.ok(props?.label);
  assert.ok(props?.customFieldKeys);
  assert.ok(props?.variants);
  assert.deepEqual(data?.required, ['variants']);
  assert.match(String(data?.description), /Merged variant fields/);
});

test('collapse-combinators falls back for non-object oneOf', () => {
  const sanitized = sanitizeToolInputSchema({
    type: 'object',
    properties: {
      value: {
        description: 'Mixed',
        oneOf: [{ type: 'string' }, { type: 'number' }],
      },
    },
  });
  const value = (sanitized.properties as Record<string, Record<string, unknown>>).value;
  assert.equal(value?.type, 'object');
  assert.equal(value?.additionalProperties, true);
  assert.equal('oneOf' in (value ?? {}), false);
  assert.match(String(value?.description), /collapsed for tool compatibility/);
});

test('ensure-root-object always returns object with properties', () => {
  const sanitized = sanitizeToolInputSchema({ type: 'string' } as never);
  assert.equal(sanitized.type, 'object');
  assert.ok(sanitized.properties);
  assert.equal(typeof sanitized.properties, 'object');
});

test('drop-meta strips $schema and $ref leftovers', () => {
  const sanitized = sanitizeToolInputSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      id: { $ref: '#/definitions/Id', type: 'string' },
    },
  });
  assert.equal('$schema' in sanitized, false);
  const id = (sanitized.properties as Record<string, Record<string, unknown>>).id;
  assert.equal('$ref' in (id ?? {}), false);
  assert.equal(id?.type, 'string');
});

test('sanitize is idempotent on a createCampaign-like fixture', () => {
  const dirty = {
    type: 'object',
    properties: {
      name: { type: 'string', example: 'Outreach' },
      schedule: {
        allOf: [
          {
            type: 'object',
            description: 'Campaign send window.',
            properties: {
              timezone: { type: 'string', example: 'America/Chicago' },
              start_hour: { type: 'integer', minimum: 0, maximum: 23 },
              days_of_week: {
                type: 'array',
                items: { type: 'integer' },
                nullable: true,
              },
            },
            required: ['timezone', 'start_hour'],
            additionalProperties: false,
          },
        ],
        nullable: true,
        description: 'Send window. null means send 24/7.',
      },
      flow: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                data: {
                  description: 'Node data',
                  oneOf: [
                    {
                      type: 'object',
                      properties: { label: { type: 'string' } },
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        variants: { type: 'array', items: { type: 'object' } },
                      },
                      required: ['variants'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              required: ['id', 'data'],
              additionalProperties: false,
            },
          },
          edges: { type: 'array', items: { type: 'object' } },
        },
        required: ['nodes', 'edges'],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };

  const once = sanitizeToolInputSchema(dirty);
  const twice = sanitizeToolInputSchema(once);
  assert.deepEqual(twice, once);
  assert.equal(lintToolInputSchema(once).length, 0);
});

test('lint reports dirty schema and assert throws', () => {
  const dirty = {
    type: 'object',
    properties: {
      x: { type: ['string', 'null'], nullable: true, oneOf: [{ type: 'string' }] },
    },
  };
  const violations = lintToolInputSchema(dirty);
  const codes = new Set(violations.map((v) => v.code));
  assert.ok(codes.has('forbidden_key'));
  assert.ok(codes.has('type_union'));
  assert.ok(codes.has('combinator'));
  assert.throws(() => assertToolInputSchemaCompatible(dirty), /not Anthropic/);

  const clean = sanitizeToolInputSchema(dirty);
  assert.equal(lintToolInputSchema(clean).length, 0);
  assert.doesNotThrow(() => assertToolInputSchemaCompatible(clean));
});

test('already-clean schemas stay structurally equivalent', () => {
  const clean = {
    type: 'object',
    properties: {
      account_id: {
        type: 'string',
        format: 'uuid',
        description: 'Workspace id.',
      },
    },
    required: ['account_id'],
    additionalProperties: false,
  };
  assert.deepEqual(sanitizeToolInputSchema(clean), clean);
});
