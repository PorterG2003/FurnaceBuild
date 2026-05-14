import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCsvBuilderRunFromRows } from './csvBuilderRuns.js';
import { parseCsvBuilderText } from './parseCsv.js';

function buildFakeLeadsClient() {
  const state: {
    runInsert: Record<string, unknown> | null;
    columnInsert: Array<Record<string, unknown>>;
    rowBatches: Array<Array<Record<string, unknown>>>;
  } = {
    runInsert: null,
    columnInsert: [],
    rowBatches: [],
  };

  const client = {
    from(table: string) {
      if (table === 'csv_builder_runs') {
        return {
          insert(payload: Record<string, unknown>) {
            state.runInsert = payload;
            return {
              select() {
                return {
                  single: async () => ({ data: { id: 'run-1', ...payload }, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === 'csv_builder_columns') {
        return {
          insert(payload: Array<Record<string, unknown>>) {
            state.columnInsert = payload;
            return {
              select: async () => ({
                data: payload.map((row, index) => ({ id: `col-${index + 1}`, ...row })),
                error: null,
              }),
            };
          },
        };
      }

      if (table === 'csv_builder_rows') {
        return {
          insert(payload: Array<Record<string, unknown>>) {
            state.rowBatches.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, state };
}

describe('csv builder server ingest', () => {
  it('parses CSV text with the same normalization rules used by the app', async () => {
    const parsed = await parseCsvBuilderText('First Name,First Name\nAda,Lovelace,extra\nGrace,Hopper');

    assert.equal(parsed.rowCount, 2);
    assert.equal(parsed.columnCount, 3);
    assert.deepEqual(parsed.headers.map((header) => header.label), ['First Name', 'First Name (2)', 'Column 3']);
    assert.ok(parsed.warnings.some((warning) => warning.includes('Duplicate header "First Name"')));
    assert.ok(parsed.warnings.some((warning) => warning.includes('extra trailing cells')));
  });

  it('creates runs with batched row inserts', async () => {
    const { client, state } = buildFakeLeadsClient();
    const rows = Array.from({ length: 501 }, (_value, index) => ({
      c001: `Company ${index + 1}`,
      c002: index + 1,
    }));

    const result = await createCsvBuilderRunFromRows(client, 'user-1', {
      account_id: 'b54b6bc7-62f4-4f0a-b2f3-73af8f6587c2',
      name: 'Large upload',
      source_file_name: 'large.csv',
      source_file_size_bytes: 1234,
      source_file_mime_type: 'text/csv',
      headers: [
        { key: 'c001', label: 'Company' },
        { key: 'c002', label: 'Index', data_type: 'number' },
      ],
      rows,
    });

    assert.equal(String(result.run.id), 'run-1');
    assert.equal(state.runInsert?.source_row_count, 501);
    assert.equal(state.columnInsert.length, 2);
    assert.equal(state.rowBatches.length, 2);
    assert.equal(state.rowBatches[0].length, 500);
    assert.equal(state.rowBatches[1].length, 1);
    assert.deepEqual(state.rowBatches[0][0]?.source_values, { c001: 'Company 1', c002: 1 });
  });
});
