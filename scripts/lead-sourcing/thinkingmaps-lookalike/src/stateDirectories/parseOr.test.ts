import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseOr } from './parseOr.js';

async function workbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Institutions');
  sheet.addRow(['Name', 'Directory_Name', 'Type', 'Street_City', 'Street_Zip', 'Director_Name', 'Iid', 'Street_State']);
  sheet.addRow(['Baker Middle School', 'Baker Middle School', 'Regular School', 'Baker City', '97814', 'Amanda Wilde', '1', 'OR']);
  sheet.addRow(['Baker SD Finance', 'Baker SD Finance', 'Finance', 'Baker City', '97814', 'Amanda Wilde', '2', 'OR']);
  sheet.addRow(['No Director School', 'No Director School', 'Regular School', 'Burns', '97720', '', '3', 'OR']);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('parseOr', () => {
  it('keeps Regular School director names and skips finance entities', async () => {
    const { rows } = await parseOr(await workbookBuffer());
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.school_name, 'Baker Middle School');
    assert.equal(rows[0]!.first_name, 'Amanda');
    assert.equal(rows[0]!.last_name, 'Wilde');
    assert.equal(rows[0]!.city, 'Baker City');
  });
});
