import type { JsonSchema } from './types.js';

/** OpenAPI / draft-meta keys that Anthropic tool schemas reject or ignore poorly. */
const OPENAPI_ONLY_KEYS = new Set([
  'nullable',
  'example',
  'examples',
  'xml',
  'discriminator',
  'readOnly',
  'writeOnly',
  'externalDocs',
]);

const META_KEYS = new Set(['$schema', '$id', '$ref', '$defs', 'definitions']);

const COMBINATOR_KEYS = ['oneOf', 'anyOf', 'allOf'] as const;

const JSON_SCHEMA_TYPES = new Set([
  'object',
  'array',
  'string',
  'integer',
  'number',
  'boolean',
  'null',
]);

export type ToolInputSchemaViolation = {
  path: string;
  code:
    | 'forbidden_key'
    | 'type_union'
    | 'combinator'
    | 'root_not_object'
    | 'missing_properties';
  detail: string;
};

export type ToolInputSchemaRule = {
  id: string;
  /** Transform one schema node after its children have been transformed. */
  transformNode: (node: JsonSchema) => JsonSchema;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function joinPath(base: string, segment: string): string {
  if (!base) return segment;
  if (segment.startsWith('[')) return `${base}${segment}`;
  return `${base}.${segment}`;
}

function appendDescription(existing: unknown, note: string): string {
  const base = typeof existing === 'string' && existing.trim() ? existing.trim() : '';
  if (!base) return note;
  if (base.includes(note)) return base;
  return `${base} ${note}`;
}

function normalizeTypeField(type: unknown): string | undefined {
  if (typeof type === 'string' && JSON_SCHEMA_TYPES.has(type) && type !== 'null') {
    return type;
  }
  if (Array.isArray(type)) {
    const nonNull = type.filter(
      (t): t is string => typeof t === 'string' && t !== 'null' && JSON_SCHEMA_TYPES.has(t),
    );
    if (nonNull.length === 1) return nonNull[0];
    if (nonNull.length > 1) return nonNull[0];
  }
  return undefined;
}

function isObjectBranch(branch: unknown): branch is JsonSchema {
  if (!isPlainObject(branch)) return false;
  if (branch.type === 'object' || branch.properties) return true;
  // Empty object schema used as a branch
  return !('type' in branch) && !('items' in branch) && !('enum' in branch);
}

function mergeObjectBranches(branches: JsonSchema[], existingDescription?: unknown): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const requiredSet = new Set<string>();
  let additionalProperties: unknown = undefined;
  let sawAdditionalProperties = false;

  for (const branch of branches) {
    const props = branch.properties;
    if (isPlainObject(props)) {
      for (const [key, value] of Object.entries(props)) {
        if (!(key in properties) && isPlainObject(value)) {
          properties[key] = value as JsonSchema;
        }
      }
    }
    if (Array.isArray(branch.required)) {
      for (const key of branch.required) {
        if (typeof key === 'string') requiredSet.add(key);
      }
    }
    if ('additionalProperties' in branch) {
      if (!sawAdditionalProperties) {
        additionalProperties = branch.additionalProperties;
        sawAdditionalProperties = true;
      } else if (branch.additionalProperties !== false) {
        additionalProperties = true;
      }
    }
  }

  const out: JsonSchema = {
    type: 'object',
    properties,
    description: appendDescription(
      existingDescription,
      '(Merged variant fields; shape depends on context.)',
    ),
  };
  if (requiredSet.size > 0) {
    out.required = [...requiredSet];
  }
  if (sawAdditionalProperties) {
    out.additionalProperties = additionalProperties;
  } else {
    out.additionalProperties = false;
  }
  return out;
}

function collapseCombinatorNode(node: JsonSchema): JsonSchema {
  let current: JsonSchema = { ...node };

  for (const key of COMBINATOR_KEYS) {
    const branches = current[key];
    if (!Array.isArray(branches) || branches.length === 0) continue;

    // Trivial allOf may still appear if earlier unwrap left multi-pass nesting.
    if (key === 'allOf' && branches.length === 1 && isPlainObject(branches[0])) {
      const { allOf: _, ...rest } = current;
      const merged: JsonSchema = { ...(branches[0] as object) };
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) merged[k] = v;
      }
      current = merged;
      continue;
    }

    const objectBranches = branches.filter(isObjectBranch) as JsonSchema[];
    const { [key]: _, description, ...rest } = current;

    if (objectBranches.length === branches.length) {
      const merged = mergeObjectBranches(objectBranches, description);
      current = { ...rest, ...merged };
      continue;
    }

    current = {
      ...rest,
      type: 'object',
      additionalProperties: true,
      description: appendDescription(
        description,
        '(Variant schema collapsed for tool compatibility; see API docs for exact shape.)',
      ),
    };
  }

  return current;
}

function stripKeys(node: JsonSchema, keys: Set<string>): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (keys.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export const TOOL_INPUT_SCHEMA_RULES: ToolInputSchemaRule[] = [
  {
    id: 'strip-openapi-keys',
    transformNode: (node) => stripKeys(node, OPENAPI_ONLY_KEYS),
  },
  {
    id: 'normalize-type-unions',
    transformNode: (node) => {
      if (!Array.isArray(node.type)) return node;
      const normalized = normalizeTypeField(node.type);
      const out: JsonSchema = { ...node };
      if (normalized) {
        out.type = normalized;
      } else {
        delete out.type;
      }
      return out;
    },
  },
  {
    id: 'unwrap-trivial-allOf',
    transformNode: (node) => {
      const branches = node.allOf;
      if (!Array.isArray(branches) || branches.length !== 1 || !isPlainObject(branches[0])) {
        return node;
      }
      const { allOf: _, ...rest } = node;
      const merged: JsonSchema = { ...(branches[0] as object) };
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) merged[key] = value;
      }
      return merged;
    },
  },
  {
    id: 'collapse-combinators',
    transformNode: (node) => {
      if (!COMBINATOR_KEYS.some((key) => Array.isArray(node[key]))) {
        return node;
      }
      return collapseCombinatorNode(node);
    },
  },
  {
    id: 'drop-meta',
    transformNode: (node) => stripKeys(node, META_KEYS),
  },
];

const ROOT_ENSURE_OBJECT: ToolInputSchemaRule = {
  id: 'ensure-root-object',
  transformNode: (node) => {
    const out: JsonSchema = { ...node, type: 'object' };
    if (!isPlainObject(out.properties)) {
      out.properties = {};
    }
    return out;
  },
};

function mapSchemaChildren(node: JsonSchema, map: (child: JsonSchema) => JsonSchema): JsonSchema {
  const out: JsonSchema = { ...node };

  if (isPlainObject(out.properties)) {
    const props: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(out.properties)) {
      props[key] = isPlainObject(value) ? map(value as JsonSchema) : (value as JsonSchema);
    }
    out.properties = props;
  }

  if (isPlainObject(out.items)) {
    out.items = map(out.items as JsonSchema);
  } else if (Array.isArray(out.items)) {
    out.items = out.items.map((item) => (isPlainObject(item) ? map(item as JsonSchema) : item));
  }

  if (isPlainObject(out.additionalProperties)) {
    out.additionalProperties = map(out.additionalProperties as JsonSchema);
  }

  if (isPlainObject(out.not)) {
    out.not = map(out.not as JsonSchema);
  }

  for (const key of COMBINATOR_KEYS) {
    const branches = out[key];
    if (Array.isArray(branches)) {
      out[key] = branches.map((branch) =>
        isPlainObject(branch) ? map(branch as JsonSchema) : branch,
      );
    }
  }

  if (Array.isArray(out.prefixItems)) {
    out.prefixItems = out.prefixItems.map((item) =>
      isPlainObject(item) ? map(item as JsonSchema) : item,
    );
  }

  if (isPlainObject(out.patternProperties)) {
    const patternProps: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(out.patternProperties)) {
      patternProps[key] = isPlainObject(value) ? map(value as JsonSchema) : (value as JsonSchema);
    }
    out.patternProperties = patternProps;
  }

  return out;
}

function applyRulesToNode(node: JsonSchema, rules: ToolInputSchemaRule[]): JsonSchema {
  // Post-order: children first so nested combinators collapse before parents merge.
  let current = mapSchemaChildren(node, (child) => applyRulesToNode(child, rules));
  for (const rule of rules) {
    current = rule.transformNode(current);
  }
  return current;
}

/**
 * Convert an OpenAPI-derived MCP tool input schema into an Anthropic-compatible
 * JSON Schema object (draft-2020-12 subset used by Claude tool calling).
 */
export function sanitizeToolInputSchema(schema: JsonSchema): JsonSchema {
  const cloned = deepClone(isPlainObject(schema) ? schema : {});
  const treeRules = TOOL_INPUT_SCHEMA_RULES;
  let result = applyRulesToNode(cloned, treeRules);
  result = ROOT_ENSURE_OBJECT.transformNode(result);
  return result;
}

function lintNode(node: unknown, path: string, out: ToolInputSchemaViolation[]): void {
  if (!isPlainObject(node)) return;

  for (const key of OPENAPI_ONLY_KEYS) {
    if (key in node) {
      out.push({
        path,
        code: 'forbidden_key',
        detail: `Forbidden OpenAPI key "${key}"`,
      });
    }
  }
  for (const key of META_KEYS) {
    if (key in node) {
      out.push({
        path,
        code: 'forbidden_key',
        detail: `Forbidden meta key "${key}"`,
      });
    }
  }
  if (Array.isArray(node.type)) {
    out.push({
      path,
      code: 'type_union',
      detail: `type must be a single string, got array ${JSON.stringify(node.type)}`,
    });
  }
  for (const key of COMBINATOR_KEYS) {
    if (key in node) {
      out.push({
        path,
        code: 'combinator',
        detail: `Forbidden combinator "${key}"`,
      });
    }
  }

  if (isPlainObject(node.properties)) {
    for (const [key, value] of Object.entries(node.properties)) {
      lintNode(value, joinPath(path, `properties.${key}`), out);
    }
  }
  if (isPlainObject(node.items)) {
    lintNode(node.items, joinPath(path, 'items'), out);
  } else if (Array.isArray(node.items)) {
    node.items.forEach((item, i) => lintNode(item, joinPath(path, `items[${i}]`), out));
  }
  if (isPlainObject(node.additionalProperties)) {
    lintNode(node.additionalProperties, joinPath(path, 'additionalProperties'), out);
  }
  for (const key of COMBINATOR_KEYS) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      branches.forEach((branch, i) => lintNode(branch, joinPath(path, `${key}[${i}]`), out));
    }
  }
}

/** Return structured violations for Anthropic/Claude tool input_schema compatibility. */
export function lintToolInputSchema(schema: JsonSchema): ToolInputSchemaViolation[] {
  const violations: ToolInputSchemaViolation[] = [];
  if (!isPlainObject(schema)) {
    violations.push({
      path: '',
      code: 'root_not_object',
      detail: 'Root schema must be an object',
    });
    return violations;
  }
  if (schema.type !== 'object') {
    violations.push({
      path: '',
      code: 'root_not_object',
      detail: `Root type must be "object" (got ${JSON.stringify(schema.type)})`,
    });
  }
  if (!isPlainObject(schema.properties)) {
    violations.push({
      path: '',
      code: 'missing_properties',
      detail: 'Root schema must include a properties object',
    });
  }
  lintNode(schema, '', violations);
  return violations;
}

export function assertToolInputSchemaCompatible(schema: JsonSchema, label = 'inputSchema'): void {
  const violations = lintToolInputSchema(schema);
  if (violations.length === 0) return;
  const summary = violations
    .slice(0, 8)
    .map((v) => `${v.path || '<root>'}: ${v.code} — ${v.detail}`)
    .join('\n');
  throw new Error(
    `${label} is not Anthropic tool-schema compatible (${violations.length} violation(s)):\n${summary}`,
  );
}
