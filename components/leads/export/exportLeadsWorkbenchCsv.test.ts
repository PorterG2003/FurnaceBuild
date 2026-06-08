import assert from 'node:assert';
import { describe, it } from 'node:test';
import { exportLeadsWorkbenchToCsv } from './exportLeadsWorkbenchCsv';
import type { LeadsColumnDef, LeadsTableRow } from '@/lib/leads/columns';

const columns: LeadsColumnDef[] = [
  {
    id: 'person-email',
    sourceType: 'person',
    sourceLabel: 'Lead info',
    fieldKey: 'email',
    label: 'Email',
    visible: true,
    width: 240,
  },
  {
    id: 'rollup-reply',
    sourceType: 'rollup',
    sourceLabel: 'Summary',
    fieldKey: 'has_reply',
    label: 'Has reply',
    visible: true,
    width: 120,
  },
  {
    id: 'rollup-activity',
    sourceType: 'rollup',
    sourceLabel: 'Summary',
    fieldKey: 'latest_activity',
    label: 'Last activity',
    visible: false,
    width: 160,
  },
];

describe('exportLeadsWorkbenchToCsv', () => {
  it('exports only visible columns', () => {
    const rows: LeadsTableRow[] = [
      {
        globalLeadId: 'lead-1',
        cells: {
          'person-email': 'ada@example.com',
          'rollup-reply': true,
          'rollup-activity': '2026-06-08T12:00:00.000Z',
        },
      },
    ];

    const csv = exportLeadsWorkbenchToCsv(rows, columns);
    assert.strictEqual(csv, 'Email,Has reply\nada@example.com,Yes');
  });

  it('quotes csv cells and clears empty placeholders', () => {
    const rows: LeadsTableRow[] = [
      {
        globalLeadId: 'lead-2',
        cells: {
          'person-email': 'hopper,"grace"@example.com',
          'rollup-reply': null,
        },
      },
    ];

    const csv = exportLeadsWorkbenchToCsv(rows, columns);
    assert.strictEqual(csv, 'Email,Has reply\n"hopper,""grace""@example.com",');
  });
});
