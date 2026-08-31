import { overrideKey } from './names.js';

export type LeaidOverride = {
  leaid: string;
  reason: string;
};

/**
 * Hand-curated CRM-name → NCES LEAID corrections.
 * Keys are `${canonicalDistrictName}|${state}`.
 *
 * NYC community/special districts are one LEA in CCD, so they collapse
 * to New York City Public Schools and cannot be lookalike targets.
 */
export const LEAID_OVERRIDES: Record<string, LeaidOverride> = {
  [overrideKey('New York City Geographic District #10', 'NY')]: {
    leaid: '3620580',
    reason: 'NYC geographic districts collapse to NYC Public Schools LEA',
  },
  [overrideKey('New York City Geographic District #12', 'NY')]: {
    leaid: '3620580',
    reason: 'NYC geographic districts collapse to NYC Public Schools LEA',
  },
  [overrideKey('New York City District #75 (Special Schools)', 'NY')]: {
    leaid: '3620580',
    reason: 'NYC District 75 collapses to NYC Public Schools LEA',
  },
  [overrideKey('Los Angeles Unified', 'CA')]: {
    leaid: '0622710',
    reason: 'LAUSD short CRM name',
  },
  [overrideKey('Hawaii Department Of Education', 'HI')]: {
    leaid: '1500030',
    reason: 'Statewide Hawaii DOE LEA',
  },
  [overrideKey('West Ada School District', 'ID')]: {
    leaid: '1602100',
    reason: 'West Ada is Joint School District No. 2 (Meridian)',
  },
  [overrideKey('Fayette County KY', 'KY')]: {
    leaid: '2101860',
    reason: 'Fayette County Public Schools (Lexington)',
  },
  [overrideKey('Chandler Unified District #80 (4242)', 'AZ')]: {
    leaid: '0401870',
    reason: 'Chandler Unified District (4242)',
  },
  [overrideKey('Montebello USD', 'CA')]: {
    leaid: '0625470',
    reason: 'Montebello Unified',
  },
  [overrideKey('Santa Ana Unified', 'CA')]: {
    leaid: '0635310',
    reason: 'Santa Ana Unified',
  },
  [overrideKey('Heartland Charter District', 'CA')]: {
    leaid: '0601590',
    reason: 'Heartland Charter District (Maricopa/Bakersfield independent-study charter LEA)',
  },
  [overrideKey('Boston Public Schools', 'MA')]: {
    leaid: '2502790',
    reason: 'Boston Public Schools',
  },
  [overrideKey('Metro Nashville Public Schools', 'TN')]: {
    leaid: '4703180',
    reason: 'Davidson County (Metro Nashville)',
  },
  [overrideKey('Chicago Public Schools', 'IL')]: {
    leaid: '1709930',
    reason: 'Chicago Public Schools Dist 299',
  },
  [overrideKey('Osceola County Public Schools', 'FL')]: {
    leaid: '1201470',
    reason: 'OSCEOLA',
  },
  [overrideKey('Alachua County PS', 'FL')]: {
    leaid: '1200030',
    reason: 'ALACHUA',
  },
  [overrideKey('Orange County (FL)', 'FL')]: {
    leaid: '1201440',
    reason: 'ORANGE',
  },
  [overrideKey('Lakeland Joint School District 272', 'ID')]: {
    leaid: '1601800',
    reason: 'Lakeland District (Rathdrum)',
  },
  [overrideKey('Community Consolidated School District 46', 'IL')]: {
    leaid: '1717520',
    reason: 'Grayslake CCSD 46',
  },
};

export function lookupOverride(canonicalAndState: string): LeaidOverride | null {
  return LEAID_OVERRIDES[canonicalAndState] ?? null;
}
