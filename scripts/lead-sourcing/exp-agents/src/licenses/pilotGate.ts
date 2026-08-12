import { join } from 'node:path';
import { saveJson } from '../checkpoint.ts';
import type {
  BrokerLeadRow,
  LicenseMatchResult,
} from '../brokerExpansionTypes.ts';

const STRONG_METHODS = new Set(['license_number', 'email', 'phone']);

export type LicensePilotGate = {
  generatedAt: string;
  requiredIdentityPrecisionPct: number;
  decision: 'HOLD_ADDITIONAL_STATES' | 'EXPAND_ADDITIONAL_STATES';
  strongMethodMatches: number;
  nameStateMatchesNeedingReview: number;
  ambiguousExcluded: number;
  licenseBackedLeads: number;
  notes: string[];
  tiers: Record<string, number>;
};

function methodsForRow(row: BrokerLeadRow): string[] {
  return (row.match_methods || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isLicenseBacked(row: BrokerLeadRow): boolean {
  return (row.signal_sources || '')
    .split('|')
    .some((part) => part.trim().startsWith('license:'));
}

export function buildLicensePilotGate(options: {
  rows: BrokerLeadRow[];
  matches: LicenseMatchResult[];
  ambiguous: LicenseMatchResult[];
}): LicensePilotGate {
  const strongMethodMatches = options.matches.filter((match) =>
    STRONG_METHODS.has(match.matchMethod),
  ).length;
  const nameStateMatchesNeedingReview = options.matches.filter(
    (match) =>
      match.matchMethod === 'name_state_unique' ||
      match.matchMethod === 'name_state_city',
  ).length;
  const licenseBackedLeads = options.rows.filter(isLicenseBacked).length;
  const tiers: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const row of options.rows) {
    tiers[row.audience_tier] = (tiers[row.audience_tier] ?? 0) + 1;
  }

  // Gate expansion on strong-method share among applied license matches.
  // Name/state joins remain in the campaign file but are not treated as
  // identity-certain enough to justify more state adapters yet.
  const applied = options.matches.length;
  const strongSharePct =
    applied > 0 ? (100 * strongMethodMatches) / applied : 0;
  const decision =
    strongSharePct >= 95 && nameStateMatchesNeedingReview === 0
      ? 'EXPAND_ADDITIONAL_STATES'
      : 'HOLD_ADDITIONAL_STATES';

  return {
    generatedAt: new Date().toISOString(),
    requiredIdentityPrecisionPct: 95,
    decision,
    strongMethodMatches,
    nameStateMatchesNeedingReview,
    ambiguousExcluded: options.ambiguous.length,
    licenseBackedLeads,
    notes: [
      `Applied license matches: ${applied} (ambiguous ${options.ambiguous.length} excluded from merge).`,
      `Strong identity methods (license_number/email/phone): ${strongMethodMatches}.`,
      'Remaining license-backed rows use unique name+state(+city) joins; spot-check license_identity_review_sample.json before treating them as identity-certain.',
      'Do not expand licensing adapters beyond CA/TX/FL until a reviewed name-match precision sample clears ~95%.',
      `Net campaign yield: ${options.rows.length} unique leads (A${tiers.A}/B${tiers.B}/C${tiers.C}/D${tiers.D}).`,
    ],
    tiers,
  };
}

export function writeLicensePilotReports(options: {
  runDir: string;
  rows: BrokerLeadRow[];
  matches: LicenseMatchResult[];
  ambiguous: LicenseMatchResult[];
}): LicensePilotGate {
  const gate = buildLicensePilotGate(options);
  saveJson(join(options.runDir, 'license_pilot_gate.json'), gate);

  const licenseRows = options.rows.filter(isLicenseBacked);
  const strong = licenseRows.filter((row) =>
    methodsForRow(row).some((method) => STRONG_METHODS.has(method)),
  );
  const weak = licenseRows.filter(
    (row) => !methodsForRow(row).some((method) => STRONG_METHODS.has(method)),
  );
  const sample = {
    generatedAt: gate.generatedAt,
    strongCount: strong.length,
    weakCount: weak.length,
    ambiguousCount: options.ambiguous.length,
    strongSample: strong.slice(0, 40),
    weakSample: weak.slice(0, 60),
    notes: [
      'Strong sample: license_number/email/phone present in match_methods.',
      'Weak sample: name_state_* only — manual identity review recommended.',
    ],
  };
  saveJson(join(options.runDir, 'license_identity_review_sample.json'), sample);
  return gate;
}
