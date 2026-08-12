import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { RunCheckpoint } from './types.js';

export const checkpointPath = (runDir: string): string => join(runDir, 'checkpoint.json');
export const rawAdsPath = (runDir: string): string => join(runDir, 'raw_ads.jsonl');

export function ensureRunDir(runDir: string): string {
  const resolved = resolve(runDir);
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

export function loadCheckpoint(runDir: string): RunCheckpoint | null {
  const path = checkpointPath(runDir);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as RunCheckpoint) : null;
}

export function saveCheckpoint(runDir: string, checkpoint: RunCheckpoint): void {
  checkpoint.updatedAt = new Date().toISOString();
  writeJson(checkpointPath(runDir), checkpoint);
}

export function writeCsv(path: string, rows: Record<string, string>[], columns: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const escape = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  writeFileSync(path, `${[columns.join(','), ...rows.map((row) => columns.map((c) => escape(row[c] ?? '')).join(','))].join('\n')}\n`);
}
