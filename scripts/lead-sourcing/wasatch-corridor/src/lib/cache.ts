import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) out[key] = sortValue(rec[key]);
    return out;
  }
  return value;
}

export function requestHash(vendor: string, request: unknown): string {
  const payload = canonicalJson({ vendor, request });
  return createHash('sha256').update(payload).digest('hex');
}

export function cachePath(cacheRoot: string, vendor: string, hash: string): string {
  return join(cacheRoot, 'raw', vendor, `${hash}.json`);
}

export type CachedResponse<T> = {
  vendor: string;
  request: unknown;
  cached_at: string;
  body: T;
};

export function readCached<T>(cacheRoot: string, vendor: string, request: unknown): CachedResponse<T> | null {
  const hash = requestHash(vendor, request);
  const path = cachePath(cacheRoot, vendor, hash);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as CachedResponse<T>;
}

export function writeCached<T>(
  cacheRoot: string,
  vendor: string,
  request: unknown,
  body: T,
): { hash: string; path: string } {
  const hash = requestHash(vendor, request);
  const path = cachePath(cacheRoot, vendor, hash);
  mkdirSync(join(path, '..'), { recursive: true });
  const record: CachedResponse<T> = {
    vendor,
    request,
    cached_at: new Date().toISOString(),
    body,
  };
  writeFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
  return { hash, path };
}

export function htmlCacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}
