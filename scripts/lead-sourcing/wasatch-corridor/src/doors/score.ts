import {
  COLD_EMAIL_HEADCOUNT_CEILING,
  COLD_EMAIL_MIN_SCORE,
  FUNDING_WINDOW_MONTHS,
  LOW_END_REVENUE,
  PE_DOOR_ENABLED,
  PROOF_WEIGHT,
  SECONDARY_DOOR_DELTA,
  WEBINAR_RECENCY_MONTHS,
  WEBINAR_RUNS_THRESHOLD,
  type DoorId,
} from '../../config/doors.js';
import type { CompanyRecord, DoorResult } from '../types.js';

export function lowEndGate(revenue: number | null, employees: number | null): {
  pass: boolean;
  low_confidence_size: boolean;
} {
  const revKnown = revenue != null && Number.isFinite(revenue) && revenue > 0;
  const empKnown = employees != null && Number.isFinite(employees);
  const rev = revKnown ? revenue : null;
  if (revKnown && rev! < LOW_END_REVENUE && (!empKnown || employees! < 10)) {
    return { pass: false, low_confidence_size: false };
  }
  const low_confidence_size = !revKnown && (!empKnown || employees! < 10);
  return { pass: true, low_confidence_size };
}

/** Apollo search band only — used for scoring when employee count is missing. Do not write a fake headcount. */
export function searchBandIsMidSize(band: string | undefined): boolean {
  const [loRaw, hiRaw] = (band ?? '').split(',');
  const lo = Number(loRaw);
  const hi = Number(hiRaw);
  return Number.isFinite(lo) && Number.isFinite(hi) && lo >= 10 && hi <= 100;
}

function monthsAgo(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44);
}

export function scoreColdEmail(company: CompanyRecord): DoorResult {
  const revenue = company.revenue_est != null && company.revenue_est > 0 ? company.revenue_est : null;
  const size = lowEndGate(revenue, company.employees);
  company.low_confidence_size = size.low_confidence_size;

  if (company.b2b_type === 'b2c') {
    return fail('cold_email', company, 'b2c');
  }
  if (company.b2b_type === 'unknown') {
    return fail('cold_email', company, 'unknown_b2b_type');
  }
  if (company.primary_buyer === 'consumer') {
    return fail('cold_email', company, 'consumer_primary_buyer');
  }
  if (company.customer_geo === 'local' || company.customer_geo === 'regional') {
    return fail('cold_email', company, 'customer_geo_limited');
  }
  if (company.employees != null && company.employees > COLD_EMAIL_HEADCOUNT_CEILING) {
    return fail('cold_email', company, 'over_200_employees');
  }
  if (!size.pass) return fail('cold_email', company, 'below_low_end_gate');
  if (company.is_outbound_shop) return fail('cold_email', company, 'outbound_shop');
  if (company.outbound_marketer_detected) return fail('cold_email', company, 'outbound_marketer_detected');

  let fit = 0;
  if (company.b2b_type === 'b2b' || company.b2b_type === 'b2b2c') fit += 20;
  else if (company.b2b_type === 'hybrid') fit += 10;

  const hc = company.employees;
  if ((hc != null && hc >= 10 && hc <= 100) || (hc == null && searchBandIsMidSize(company.search_employee_band))) {
    fit += 10;
  } else if ((hc != null && hc >= 1 && hc <= 9 && (company.revenue_est ?? 0) >= LOW_END_REVENUE) || (hc != null && hc >= 101 && hc <= 200)) {
    fit += 5;
  }

  if (revenue != null && revenue >= LOW_END_REVENUE) fit += 10;
  else if (revenue == null) fit += 5;

  let need = 0;
  const noOm = !company.outbound_marketer_detected;
  const sdrs = company.sdr_headcount ?? 0;
  const aes = company.ae_headcount ?? 0;
  if (noOm && sdrs > 0) need += 18;
  else if (noOm && aes > 0 && sdrs === 0) need += 9;
  if (company.sequencer_orphaned) need += 10;
  if (company.hiring_gtm) need += 5;
  if ((company.headcount_growth_pct ?? 0) > 0) need += 4;
  const fundedMonths = monthsAgo(company.last_funding_date);
  if (fundedMonths != null && fundedMonths <= FUNDING_WINDOW_MONTHS) need += 3;

  let reach = 0;
  if (company.hq_verification === 'A') reach += 10;
  if (company.live_site) reach += 5;
  if (company.named_dm_discoverable) reach += 5;

  const score = fit + need + reach;
  if (score < COLD_EMAIL_MIN_SCORE) {
    return fail('cold_email', company, 'below_min_score');
  }
  return {
    company_id: company.company_id,
    door: 'cold_email',
    qualified: true,
    score,
    exclusion_reason: '',
    routing_score: score * PROOF_WEIGHT.cold_email,
  };
}

export function scoreWebinar(company: CompanyRecord): DoorResult {
  if ((company.runs_webinars ?? 0) < WEBINAR_RUNS_THRESHOLD) {
    return fail('webinar', company, 'runs_webinars_below_threshold');
  }
  if (company.webinar_purpose !== 'sales_pipeline' && company.webinar_purpose !== 'brand_awareness') {
    return fail('webinar', company, 'training_or_unknown_purpose');
  }
  const recencyMonths = monthsAgo(normalizeRecency(company.webinar_recency));
  const recent = recencyMonths != null && recencyMonths <= WEBINAR_RECENCY_MONTHS;
  if (!recent && company.webinar_cadence !== 'recurring') {
    return fail('webinar', company, 'stale_webinar');
  }
  if (company.webinar_role_detected) return fail('webinar', company, 'webinar_role_detected');

  let practice = 0;
  if (company.has_registration_page) practice += 15;
  if (company.webinar_purpose === 'sales_pipeline' || company.webinar_purpose === 'brand_awareness') practice += 15;
  if (company.webinar_cadence === 'recurring') practice += 10;

  let audience = 0;
  if (company.audience_is_ce_profession) audience += 25;
  else if (company.audience_nameable) audience += 12;
  else audience += 5;
  if (company.audience_nameable || company.audience_is_ce_profession) audience += 10;

  let capacity = 0;
  if (company.wants_more_attendance) capacity += 10;
  if (company.has_sales_motion) capacity += 8;
  if (!company.webinar_role_detected) capacity += 7;

  const score = practice + audience + capacity;
  return {
    company_id: company.company_id,
    door: 'webinar',
    qualified: true,
    score,
    exclusion_reason: '',
    routing_score: score * PROOF_WEIGHT.webinar,
  };
}

export function scorePe(_company: CompanyRecord): DoorResult {
  return {
    company_id: _company.company_id,
    door: 'pe_sourcing',
    qualified: false,
    score: null,
    exclusion_reason: PE_DOOR_ENABLED ? '' : 'reserved_not_built',
    routing_score: null,
  };
}

function fail(door: DoorId, company: CompanyRecord, reason: string): DoorResult {
  return {
    company_id: company.company_id,
    door,
    qualified: false,
    score: null,
    exclusion_reason: reason,
    routing_score: null,
  };
}

function normalizeRecency(value: string): string {
  if (!value) return '';
  const t = Date.parse(value);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return value;
}

export type RoutedCompany = {
  company_id: string;
  primary_door: DoorId | 'none';
  secondary_door: DoorId | '';
  routing_score: number;
  doors: DoorResult[];
};

export function routeCompany(doors: DoorResult[]): RoutedCompany {
  const qualified = doors.filter((d) => d.qualified && d.routing_score != null);
  qualified.sort((a, b) => (b.routing_score ?? 0) - (a.routing_score ?? 0));
  if (!qualified.length) {
    return {
      company_id: doors[0]?.company_id ?? '',
      primary_door: 'none',
      secondary_door: '',
      routing_score: 0,
      doors,
    };
  }
  const primary = qualified[0];
  const secondary = qualified[1];
  const secondary_door =
    secondary && (primary.routing_score ?? 0) - (secondary.routing_score ?? 0) <= SECONDARY_DOOR_DELTA
      ? secondary.door
      : '';
  return {
    company_id: primary.company_id,
    primary_door: primary.door,
    secondary_door,
    routing_score: primary.routing_score ?? 0,
    doors,
  };
}

export function scoreAllDoors(company: CompanyRecord): RoutedCompany {
  const doors = [scoreColdEmail(company), scoreWebinar(company), scorePe(company)];
  return routeCompany(doors);
}
