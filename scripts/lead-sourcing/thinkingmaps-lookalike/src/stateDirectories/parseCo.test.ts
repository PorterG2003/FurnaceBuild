import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseCo } from './parseCo.js';

async function workbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Schools');
  sheet.addRow([
    'School Code',
    'School Name',
    'District Name',
    'Physical City',
    'Physical Zip',
    'Principal First Name',
    'Principal Last Name',
    'Principal Email Address',
    'Co-Principal First Name',
    'Co-Principal Last Name',
    'Co-Principal Email Address',
  ]);
  sheet.addRow([
    '0010',
    'Denver High',
    'Denver County 1',
    'Denver',
    '80203',
    'Sam',
    'Park',
    'sam.park@dpsk12.net',
    'Lee',
    'Ng',
    'lee.ng@dpsk12.net',
  ]);
  sheet.addRow(['0011', 'Empty School', 'Denver County 1', 'Denver', '80204', '', '', '', '', '', '']);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('parseCo', () => {
  it('emits principal and co-principal rows with emails', async () => {
    const { rows } = await parseCo(await workbookBuffer());
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.title, 'Principal');
    assert.equal(rows[0]!.email, 'sam.park@dpsk12.net');
    assert.equal(rows[1]!.title, 'Co-Principal');
    assert.equal(rows[1]!.first_name, 'Lee');
    assert.equal(rows[1]!.email, 'lee.ng@dpsk12.net');
  });
});
