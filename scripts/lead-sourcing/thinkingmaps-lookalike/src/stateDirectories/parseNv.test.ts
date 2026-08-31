import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseNv } from './parseNv.js';

async function workbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Schools');
  sheet.addRow(['NV State School List Information By Active School Year']);
  sheet.addRow([
    'Name',
    'Principal Name',
    'Principal Email',
    'NCES DistrictID',
    'NCES School ID',
    'State School Code',
    'City',
  ]);
  sheet.addRow([
    'Abston ES',
    'Maria Lopez',
    'HINCHRW@NV.CCSD.NET',
    '3200060',
    '00001',
    '783',
    'Las Vegas',
  ]);
  sheet.addRow(['Closed Placeholder', '', '', '3200060', '00002', '999', 'Las Vegas']);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('parseNv', () => {
  it('keeps principal name, email, and NCES id', async () => {
    const { rows } = await parseNv(await workbookBuffer());
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'Abston ES');
    assert.equal(rows[0]!.first_name, 'Maria');
    assert.equal(rows[0]!.last_name, 'Lopez');
    assert.equal(rows[0]!.email, 'hinchrw@nv.ccsd.net');
    assert.equal(rows[0]!.nces_school_id, '320006000001');
  });
});
