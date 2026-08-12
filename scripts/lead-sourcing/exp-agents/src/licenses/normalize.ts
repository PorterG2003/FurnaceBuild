import type { LicenseRecord } from '../brokerExpansionTypes.ts';
import { normalizeName } from '../rosterMatch.ts';

function pick(row: Record<string, string>, keys: string[]): string {
  const lower = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase()) ?? (row[key] != null ? key : undefined);
    if (!actual) continue;
    const value = row[actual]?.trim();
    if (value) return value;
  }
  return '';
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.replace(/\s+/g, ' ').trim();
  if (!cleaned) return { firstName: '', lastName: '' };
  if (cleaned.includes(',')) {
    const [last, rest = ''] = cleaned.split(',').map((part) => part.trim());
    const first = rest.split(/\s+/)[0] ?? '';
    return { firstName: first, lastName: last };
  }
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

function truthyFlag(value: string): boolean {
  return /^(y|yes|true|1|t)$/i.test(value.trim());
}

export function normalizeCaDreRow(row: Record<string, string>): LicenseRecord | null {
  const licenseNumber = pick(row, [
    'lic_number',
    'License Number',
    'license_number',
    'LicenseNumber',
    'LIC_NBR',
  ]);
  const licenseType = pick(row, [
    'lic_type',
    'License Type',
    'license_type',
    'LicenseType',
    'LIC_TYPE',
  ]);
  const lastName = pick(row, ['lastname_primary', 'Last Name', 'last_name']);
  const firstName = pick(row, ['firstname_secondary', 'First Name', 'first_name']);
  const fullName =
    pick(row, ['Name', 'full_name', 'FULL_NAME', 'Licensee Name']) ||
    `${firstName} ${lastName}`.trim();
  if (!licenseNumber && !fullName) return null;
  const split = splitName(fullName);
  return {
    source: 'ca_dre',
    licenseNumber: licenseNumber.toUpperCase(),
    licenseType,
    status: pick(row, ['lic_status', 'License Status', 'status', 'Status']),
    fullName,
    firstName: firstName || split.firstName,
    lastName: lastName || split.lastName,
    state: pick(row, ['state', 'State']) || 'CA',
    city: pick(row, ['city', 'City', 'Mailing City']),
    county: pick(row, ['county_name', 'County', 'county']),
    email: pick(row, ['Email', 'email']),
    phone: pick(row, ['Phone', 'phone', 'Telephone']),
    expiration: pick(row, [
      'lic_expiration_date',
      'Expiration Date',
      'expiration',
      'License Expiration Date',
    ]),
    designatedSupervisor:
      (/broker/i.test(licenseType) && /officer|designated|qualifying/i.test(licenseType)) ||
      /officer/i.test(pick(row, ['related_lic_type', 'Related License Type'])),
    sponsoringBroker: pick(row, [
      'related_lastname_primary',
      'Employing Broker',
      'Broker Name',
      'sponsoring_broker',
    ]),
    agencyName: pick(row, ['Corporation Name', 'Business Name', 'agency']),
    raw: row,
  };
}

export function normalizeTxTrecRow(row: Record<string, string>): LicenseRecord | null {
  const licenseNumber = pick(row, [
    'License Number',
    'license_number',
    'LicenseNumber',
  ]);
  const licenseType = pick(row, ['License Type', 'license_type', 'LicenseType']);
  const fullName = pick(row, ['Full Name', 'full_name', 'Name']);
  if (!licenseNumber && !fullName) return null;
  const { firstName, lastName } = splitName(fullName);
  return {
    source: 'tx_trec',
    licenseNumber: licenseNumber.toUpperCase(),
    licenseType,
    status: pick(row, ['Status', 'status']),
    fullName,
    firstName,
    lastName,
    state: 'TX',
    city: pick(row, ['City', 'city']),
    county: pick(row, ['County', 'county']),
    email: pick(row, ['Email', 'email']),
    phone: pick(row, ['Phone', 'phone']),
    expiration: pick(row, [
      'License Expiration Date',
      'license_expiration_date',
      'Expiration Date',
    ]),
    designatedSupervisor: truthyFlag(
      pick(row, [
        'Designated Supervisor Flag',
        'designated_supervisor_flag',
        'Designated Supervisor',
      ]),
    ),
    sponsoringBroker: pick(row, [
      'Related License Full Name',
      'related_license_full_name',
      'Sponsoring Broker',
    ]),
    agencyName: pick(row, ['Related License Full Name', 'related_license_full_name']),
    raw: row,
  };
}

/** DBPR weekly extract is often headerless; map known positional layout. */
export function normalizeFlDbprPositional(values: string[]): LicenseRecord | null {
  if (values.length < 12) return null;
  const fullName = (values[1] ?? '').trim();
  const licenseType = (values[3] ?? '').trim();
  const city = (values[7] ?? '').trim();
  const state = (values[8] ?? 'FL').trim() || 'FL';
  const county = (values[10] ?? '').trim();
  const licenseNumber = ((values[17] ?? values[11] ?? '') as string).trim();
  const status = [values[12], values[13]].filter(Boolean).join(' ').trim();
  const expiration = (values[16] ?? '').trim();
  const agencyName = (values[19] ?? '').trim();
  if (!fullName && !licenseNumber) return null;
  const { firstName, lastName } = splitName(fullName);
  return {
    source: 'fl_dbpr',
    licenseNumber: licenseNumber.toUpperCase(),
    licenseType,
    status,
    fullName,
    firstName,
    lastName,
    state: state || 'FL',
    city,
    county,
    email: '',
    phone: '',
    expiration,
    designatedSupervisor:
      /broker/i.test(licenseType) && /qualifying|managing|designated/i.test(licenseType),
    sponsoringBroker: agencyName,
    agencyName,
    raw: Object.fromEntries(values.map((value, index) => [`col_${index}`, value])),
  };
}

export function normalizeFlDbprRow(row: Record<string, string>): LicenseRecord | null {
  // Headerless FL extracts get synthetic col_N keys from ingest.
  if (row.col_1 != null || row.col_3 != null) {
    const values: string[] = [];
    for (let i = 0; i < 24; i++) values.push(row[`col_${i}`] ?? '');
    return normalizeFlDbprPositional(values);
  }
  const licenseNumber = pick(row, [
    'License Number',
    'license_number',
    'LICNBR',
    'Lic Number',
  ]);
  const licenseType = pick(row, [
    'License Type',
    'license_type',
    'Rank Description',
    'LICTYPE',
    'Profession',
  ]);
  const fullName =
    pick(row, ['Full Name', 'full_name', 'Name']) ||
    `${pick(row, ['First Name', 'first_name', 'FIRSTNAME'])} ${pick(row, [
      'Last Name',
      'last_name',
      'LASTNAME',
    ])}`.trim();
  if (!licenseNumber && !fullName) return null;
  const { firstName, lastName } = splitName(fullName);
  return {
    source: 'fl_dbpr',
    licenseNumber: licenseNumber.toUpperCase(),
    licenseType,
    status: pick(row, ['License Status', 'status', 'Status Description', 'LICSTATUS']),
    fullName,
    firstName: firstName || pick(row, ['First Name', 'first_name', 'FIRSTNAME']),
    lastName: lastName || pick(row, ['Last Name', 'last_name', 'LASTNAME']),
    state: 'FL',
    city: pick(row, ['City', 'city', 'MAILCITY']),
    county: pick(row, ['County', 'county']),
    email: pick(row, ['Email', 'email', 'EMAIL']),
    phone: pick(row, ['Phone', 'phone', 'PHONE']),
    expiration: pick(row, ['Expiration Date', 'expiration', 'EXPIREDATE']),
    designatedSupervisor: /broker/i.test(licenseType) && /qualifying|managing|designated/i.test(licenseType),
    sponsoringBroker: pick(row, ['Employer', 'Business Name', 'BOARDNAME']),
    agencyName: pick(row, ['Business Name', 'DBA', 'BOARDNAME']),
    raw: row,
  };
}

export function isBrokerishLicense(record: LicenseRecord): boolean {
  return /\bbroker\b/i.test(record.licenseType) || record.designatedSupervisor;
}

export function licenseNameKey(record: LicenseRecord): string {
  const name =
    normalizeName(`${record.firstName} ${record.lastName}`) ||
    normalizeName(record.fullName);
  return `${name}|${record.state.toUpperCase()}`;
}
