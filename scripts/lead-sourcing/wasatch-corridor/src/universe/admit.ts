import { join } from 'node:path';
import { passesCorridorInclusion } from '../../config/geography.js';
import { writeJsonl } from '../lib/jsonl.js';
import { RequestGate } from '../lib/retry.js';
import type { CompanyRecord, PipelineContext, ReviewRow } from '../types.js';
import { isGovK12Religious, looksLikeOutOfStateHq } from './normalize.js';
import { geocodeAddress, reverseGeocode } from './geocode.js';

export async function admitUniverse(
  ctx: PipelineContext,
  companies: CompanyRecord[],
): Promise<{ admitted: CompanyRecord[]; review: ReviewRow[]; excluded: CompanyRecord[] }> {
  const gate = new RequestGate(1100, 4);
  const review: ReviewRow[] = [];
  const admitted: CompanyRecord[] = [];
  const excluded: CompanyRecord[] = [];

  for (const company of companies) {
    if (company.parked_or_shared_host) {
      company.universe_status = 'review';
      company.universe_reason = 'parked_or_shared_host';
      review.push({
        company_id: company.company_id,
        company: company.name,
        domain: company.domain ?? '',
        reason: 'parked_or_shared_host',
        stage: 'admit',
      });
      continue;
    }

    if (looksLikeOutOfStateHq(company)) {
      company.universe_status = 'excluded';
      company.universe_reason = 'branch';
      excluded.push(company);
      continue;
    }

    if (isGovK12Religious(company)) {
      company.universe_status = 'excluded';
      company.universe_reason = 'gov_k12_religious';
      excluded.push(company);
      continue;
    }

    if (ctx.skipGeo) {
      if (!company.city && company.query_city) company.city = company.query_city;
      const operating = Boolean(company.domain);
      if (!operating) {
        company.universe_status = 'review';
        company.universe_reason = 'no_operating_signal';
        review.push({
          company_id: company.company_id,
          company: company.name,
          domain: '',
          reason: 'no_operating_signal',
          stage: 'admit',
        });
        continue;
      }
      company.universe_status = 'admitted';
      company.universe_reason = 'search_location_unverified';
      admitted.push(company);
      continue;
    }

    if (!company.street && company.lat == null) {
      company.universe_status = 'review';
      company.universe_reason = 'missing_address';
      review.push({
        company_id: company.company_id,
        company: company.name,
        domain: company.domain ?? '',
        reason: 'missing_address',
        stage: 'admit',
      });
      continue;
    }

    const address = [company.street, company.city, company.state, company.postal].filter(Boolean).join(', ');
    if (company.lat != null && company.lng != null && !company.fips) {
      const rev = await reverseGeocode(ctx, gate, company.lat, company.lng);
      company.fips = rev.fips;
      company.census_place = rev.placeName ?? company.census_place;
      company.county = rev.county ?? company.county;
      if (rev.lat != null) company.lat = rev.lat;
      if (rev.lng != null) company.lng = rev.lng;
    } else if (address && (company.lat == null || company.fips == null)) {
      const geo = await geocodeAddress(ctx, gate, address);
      if (!geo.matched) {
        company.universe_status = 'review';
        company.universe_reason = 'geocode_failure';
        review.push({
          company_id: company.company_id,
          company: company.name,
          domain: company.domain ?? '',
          reason: 'geocode_failure',
          stage: 'admit',
        });
        continue;
      }
      company.lat = geo.lat;
      company.lng = geo.lng;
      company.fips = geo.fips;
      company.census_place = geo.placeName;
      company.county = geo.county ?? company.county;
      company.provenance.lat = { source: 'census', cached_at: new Date().toISOString() };
    }

    if (!passesCorridorInclusion({ lat: company.lat, fips: company.fips, placeName: company.census_place || company.city })) {
      company.universe_status = 'excluded';
      company.universe_reason = 'outside_corridor';
      excluded.push(company);
      continue;
    }

    const operating =
      Boolean(company.domain) ||
      Boolean(company.street && (company.sources.includes('fsq') || company.sources.includes('epa')));
    if (!operating) {
      company.universe_status = 'review';
      company.universe_reason = 'no_operating_signal';
      review.push({
        company_id: company.company_id,
        company: company.name,
        domain: '',
        reason: 'no_operating_signal',
        stage: 'admit',
      });
      continue;
    }

    company.universe_status = 'admitted';
    company.universe_reason = '';
    admitted.push(company);
  }

  writeJsonl(join(ctx.runDir, 'universe', 'admitted.jsonl'), admitted);
  writeJsonl(join(ctx.runDir, 'universe', 'review.jsonl'), review);
  writeJsonl(join(ctx.runDir, 'universe', 'excluded.jsonl'), excluded);
  return { admitted, review, excluded };
}
