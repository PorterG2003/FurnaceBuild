import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseIl } from './parseIl.js';

async function workbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Public Sch and Dist');
  sheet.addRow(['RCDTS', 'Facility Name', 'District Name', 'City', 'Zip', 'Type', 'Administrator', 'Email', 'NCES ID']);
  sheet.addRow([
    '1501629900123',
    'Lincoln Elementary',
    'Chicago Public Schools Dist 299',
    'Chicago',
    '60601',
    'Public School',
    'Maria Lopez',
    'mlopez@cps.edu',
    '170993000123',
  ]);
  sheet.addRow([
    '1501629900000',
    'Chicago Public Schools Dist 299',
    'Chicago Public Schools Dist 299',
    'Chicago',
    '60601',
    'Public District',
    'Pedro Supt',
    'supt@cps.edu',
    '1709930',
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('parseIl', () => {
  it('keeps school rows with NCES ids and skips district entities', async () => {
    const { rows } = await parseIl(await workbookBuffer());
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'Lincoln Elementary');
    assert.equal(rows[0]!.first_name, 'Maria');
    assert.equal(rows[0]!.last_name, 'Lopez');
    assert.equal(rows[0]!.email, 'mlopez@cps.edu');
    assert.equal(rows[0]!.nces_school_id, '170993000123');
  });
});
