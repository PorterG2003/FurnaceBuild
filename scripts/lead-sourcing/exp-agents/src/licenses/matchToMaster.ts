import type {
  LicenseMatchMethod,
  LicenseMatchResult,
  LicenseRecord,
} from '../brokerExpansionTypes.ts';
import {
  extractLicenseNumbersFromBio,
  masterNameKey,
} from '../mergeBrokerExpansion.ts';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type MasterAgent,
} from '../rosterMatch.ts';
import { isBrokerishLicense, licenseNameKey } from './normalize.ts';

export function matchLicensesToMaster(
  master: MasterAgent[],
  licenses: LicenseRecord[],
): {
  matches: LicenseMatchResult[];
  ambiguous: LicenseMatchResult[];
  unmatchedLicenses: number;
  brokerishLicenses: number;
} {
  const byLicenseNumber = new Map<string, MasterAgent[]>();
  const byEmail = new Map<string, MasterAgent>();
  const byPhone = new Map<string, MasterAgent[]>();
  const byNameState = new Map<string, MasterAgent[]>();
  const byNameStateCity = new Map<string, MasterAgent[]>();

  for (const row of master) {
    for (const number of extractLicenseNumbersFromBio(row.bio)) {
      const normalized = number.replace(/^0+/, '').toUpperCase() || number.toUpperCase();
      for (const key of new Set([number.toUpperCase(), normalized])) {
        const bucket = byLicenseNumber.get(key) ?? [];
        bucket.push(row);
        byLicenseNumber.set(key, bucket);
      }
    }
    if (row.email) {
      const email = normalizeEmail(row.email);
      if (!byEmail.has(email)) byEmail.set(email, row);
    }
    const phone = normalizePhone(row.phone ?? '');
    if (phone.length >= 10) {
      const bucket = byPhone.get(phone) ?? [];
      bucket.push(row);
      byPhone.set(phone, bucket);
    }
    const nameKey = masterNameKey(row);
    const nameBucket = byNameState.get(nameKey) ?? [];
    nameBucket.push(row);
    byNameState.set(nameKey, nameBucket);
    const city = normalizeName(row.city);
    if (city) {
      const cityKey = `${nameKey}|${city}`;
      const cityBucket = byNameStateCity.get(cityKey) ?? [];
      cityBucket.push(row);
      byNameStateCity.set(cityKey, cityBucket);
    }
  }

  const matches: LicenseMatchResult[] = [];
  const ambiguous: LicenseMatchResult[] = [];
  let unmatchedLicenses = 0;
  let brokerishLicenses = 0;

  for (const license of licenses) {
    if (isBrokerishLicense(license)) brokerishLicenses += 1;
    else continue; // lead-yield pilot only cares about broker-class licenses

    let method: LicenseMatchMethod = '';
    let candidates: MasterAgent[] = [];

    if (license.licenseNumber) {
      const raw = license.licenseNumber.toUpperCase();
      const stripped = raw.replace(/^0+/, '') || raw;
      candidates =
        byLicenseNumber.get(raw) ??
        byLicenseNumber.get(stripped) ??
        [];
      if (candidates.length) method = 'license_number';
    }
    if (!candidates.length && license.email) {
      const hit = byEmail.get(normalizeEmail(license.email));
      if (hit) {
        candidates = [hit];
        method = 'email';
      }
    }
    if (!candidates.length && license.phone) {
      const phone = normalizePhone(license.phone);
      if (phone.length >= 10) {
        candidates = byPhone.get(phone) ?? [];
        if (candidates.length) method = 'phone';
      }
    }
    if (!candidates.length) {
      const nameKey = licenseNameKey(license);
      const city = normalizeName(license.city);
      if (city) {
        const cityHits = byNameStateCity.get(`${nameKey}|${city}`) ?? [];
        if (cityHits.length === 1) {
          candidates = cityHits;
          method = 'name_state_city';
        } else if (cityHits.length > 1) {
          candidates = cityHits;
          method = 'name_state_city';
        }
      }
      if (!candidates.length) {
        const nameHits = byNameState.get(nameKey) ?? [];
        candidates = nameHits;
        method = nameHits.length ? 'name_state_unique' : '';
      }
    }

    if (!candidates.length || !method) {
      unmatchedLicenses += 1;
      continue;
    }
    if (candidates.length !== 1) {
      for (const candidate of candidates) {
        ambiguous.push({
          masterId: candidate.id,
          license,
          matchMethod: method,
          ambiguous: true,
        });
      }
      continue;
    }
    // Reject common-name-only matches without city/license/email/phone support.
    if (method === 'name_state_unique') {
      const nameHits = byNameState.get(licenseNameKey(license)) ?? [];
      if (nameHits.length !== 1) {
        unmatchedLicenses += 1;
        continue;
      }
    }
    matches.push({
      masterId: candidates[0].id,
      license,
      matchMethod: method,
      ambiguous: false,
    });
  }

  return { matches, ambiguous, unmatchedLicenses, brokerishLicenses };
}
