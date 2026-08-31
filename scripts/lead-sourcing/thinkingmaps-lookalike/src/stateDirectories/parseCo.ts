import { blankRow, hasPersonName, normalizeEmail, pickField, recordsFromWorkbook } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function principalFrom(
  rec: Record<string, string>,
  firstAliases: string[],
  lastAliases: string[],
  emailAliases: string[],
  title: string,
): StateDirectoryRow | null {
  const row = blankRow('CO');
  row.state_school_id = pickField(rec, ['School Code', 'SchoolCode', 'Code']);
  row.district_name = pickField(rec, ['District Name', 'District', 'Organization Name']);
  row.school_name = pickField(rec, ['School Name', 'School', 'Name of School']);
  row.city = pickField(rec, ['Physical City', 'Mailing City', 'City']);
  row.zip = pickField(rec, ['Physical Zip', 'Mailing Zip', 'Zip']);
  row.first_name = pickField(rec, firstAliases);
  row.last_name = pickField(rec, lastAliases);
  row.email = normalizeEmail(pickField(rec, emailAliases));
  row.title = title;
  return hasPersonName(row) && row.school_name ? row : null;
}

export async function parseCo(buffer: Buffer): Promise<ParseResult> {
  const records = await recordsFromWorkbook(buffer);
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const principal = principalFrom(
      rec,
      ['Principal First Name', 'Principal First'],
      ['Principal Last Name', 'Principal Last'],
      ['Principal Email Address', 'Principal Email'],
      'Principal',
    );
    if (principal) rows.push(principal);
    const co = principalFrom(
      rec,
      ['Co-Principal First Name', 'Co Principal First Name', 'Coprincipal First Name'],
      ['Co-Principal Last Name', 'Co Principal Last Name', 'Coprincipal Last Name'],
      ['Co-Principal Email Address', 'Co Principal Email Address', 'Co-Principal Email'],
      'Co-Principal',
    );
    if (co) rows.push(co);
  }
  return { rows, districtStaff: [] };
}
