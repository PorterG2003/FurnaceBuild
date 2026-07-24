import type { JsonSchema } from './types.js';

/**
 * Deep-clone and fully resolve local `#/…` $refs inside a JSON Schema / OpenAPI document.
 */
export function resolveJsonRefs(root: unknown): unknown {
  function resolvePointer(pointer: string): unknown {
    if (!pointer.startsWith('#/')) {
      throw new Error(`Only local JSON Schema refs are supported (got ${pointer})`);
    }
    const parts = pointer
      .slice(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur: unknown = root;
    for (const part of parts) {
      if (cur === null || typeof cur !== 'object' || !(part in (cur as object))) {
        throw new Error(`Unresolved JSON Schema $ref: ${pointer}`);
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  function walk(node: unknown, refStack: Set<string>): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, refStack));
    }
    if (node === null || typeof node !== 'object') {
      return node;
    }

    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === 'string') {
      const pointer = obj.$ref;
      if (refStack.has(pointer)) {
        return {};
      }
      const nextStack = new Set(refStack);
      nextStack.add(pointer);
      const target = resolvePointer(pointer);
      const { $ref: _, ...rest } = obj;
      const resolved = walk(target, nextStack);
      if (
        resolved &&
        typeof resolved === 'object' &&
        !Array.isArray(resolved) &&
        Object.keys(rest).length > 0
      ) {
        return { ...(resolved as object), ...(walk(rest, nextStack) as object) };
      }
      return resolved;
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = walk(value, refStack);
    }
    return out;
  }

  return walk(root, new Set());
}

export function asObjectSchema(schema: unknown): JsonSchema {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return schema as JsonSchema;
  }
  return { type: 'object', properties: {}, additionalProperties: true };
}
