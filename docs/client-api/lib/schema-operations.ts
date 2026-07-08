import fs from 'node:fs';
import path from 'node:path';

export type SchemaOperationRef = {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace';
};

type OpenApiSpec = {
  paths?: Record<string, Partial<Record<SchemaOperationRef['method'], { responses?: Record<string, unknown>; requestBody?: unknown }>>>;
  components?: { schemas?: Record<string, unknown> };
};

function collectSchemaRefs(value: unknown, refs: Set<string>): void {
  if (!value || typeof value !== 'object') return;

  if ('$ref' in value && typeof value.$ref === 'string') {
    const match = value.$ref.match(/#\/components\/schemas\/(.+)$/);
    if (match?.[1]) refs.add(match[1]);
  }

  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, refs);
    return;
  }

  for (const nested of Object.values(value)) {
    collectSchemaRefs(nested, refs);
  }
}

export function buildSchemaOperationMap(): Map<string, SchemaOperationRef> {
  const specPath = path.join(process.cwd(), 'public', 'openapi.json');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as OpenApiSpec;
  const schemaNames = Object.keys(spec.components?.schemas ?? {});
  const map = new Map<string, SchemaOperationRef>();

  for (const [routePath, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of Object.keys(pathItem) as SchemaOperationRef['method'][]) {
      const operation = pathItem[method];
      if (!operation) continue;

      const refs = new Set<string>();
      collectSchemaRefs(operation.responses, refs);
      collectSchemaRefs(operation.requestBody, refs);

      for (const schemaName of refs) {
        if (!map.has(schemaName)) {
          map.set(schemaName, { path: routePath, method });
        }
      }
    }
  }

  for (const schemaName of schemaNames) {
    if (!map.has(schemaName)) {
      map.set(schemaName, { path: '/health', method: 'get' });
    }
  }

  return map;
}

export function getSchemaOperation(name: string): SchemaOperationRef | undefined {
  return buildSchemaOperationMap().get(name);
}

export function getSchemaDescription(name: string): string | undefined {
  const specPath = path.join(process.cwd(), 'public', 'openapi.json');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as OpenApiSpec;
  const schema = spec.components?.schemas?.[name];
  if (!schema || typeof schema !== 'object' || !('description' in schema)) return undefined;
  return typeof schema.description === 'string' ? schema.description : undefined;
}
