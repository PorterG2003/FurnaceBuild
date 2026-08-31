import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyCompany } from '../types.js';
import { lowEndGate, routeCompany, scoreColdEmail, scoreWebinar, searchBandIsMidSize } from './score.js';

function base(overrides: Parameters<typeof emptyCompany>[0]) {
  return emptyCompany({ company_id: 'dom:example.test', name: 'Example', ...overrides });
}

test('low-end gate: fail only on known tiny revenue', () => {
  assert.equal(lowEndGate(200_000, 4).pass, false);
  assert.equal(lowEndGate(200_000, null).pass, false);
  assert.equal(lowEndGate(500_000, 4).pass, true);
  assert.equal(lowEndGate(null, 4).pass, true);
  assert.equal(lowEndGate(null, 4).low_confidence_size, true);
  assert.equal(lowEndGate(null, 20).low_confidence_size, false);
  assert.equal(lowEndGate(null, null).pass, true);
  assert.equal(lowEndGate(null, null).low_confidence_size, true);
});

test('cold email scoring tables and exclusions', () => {
  const qualified = scoreColdEmail(
    base({
      b2b_type: 'b2b',
      primary_buyer: 'business',
      customer_geo: 'us',
      employees: 40,
      revenue_est: 800_000,
      sdr_headcount: 2,
      sequencer_orphaned: true,
      live_site: true,
      hq_verification: 'A',
      named_dm_discoverable: true,
      hiring_gtm: true,
      headcount_growth_pct: 10,
      last_funding_date: new Date().toISOString(),
    }),
  );
  assert.equal(qualified.qualified, true);
  assert.equal(qualified.score, 20 + 10 + 10 + 18 + 10 + 5 + 4 + 3 + 10 + 5 + 5);

  assert.equal(scoreColdEmail(base({ b2b_type: 'b2c', employees: 40 })).qualified, false);
  assert.equal(scoreColdEmail(base({ b2b_type: 'unknown', employees: 40 })).exclusion_reason, 'unknown_b2b_type');
  assert.equal(
    scoreColdEmail(base({ b2b_type: 'hybrid', primary_buyer: 'consumer', customer_geo: 'us', employees: 40 })).exclusion_reason,
    'consumer_primary_buyer',
  );
  assert.equal(
    scoreColdEmail(base({ b2b_type: 'b2b', primary_buyer: 'business', customer_geo: 'local', employees: 40 })).exclusion_reason,
    'customer_geo_limited',
  );
  assert.equal(
    scoreColdEmail(base({ b2b_type: 'b2b', primary_buyer: 'business', customer_geo: 'regional', employees: 40 })).exclusion_reason,
    'customer_geo_limited',
  );
  assert.equal(scoreColdEmail(base({ b2b_type: 'b2b', employees: 250 })).exclusion_reason, 'over_200_employees');
  assert.equal(scoreColdEmail(base({ b2b_type: 'b2b', employees: 20, is_outbound_shop: true })).exclusion_reason, 'outbound_shop');
  assert.equal(
    scoreColdEmail(base({ b2b_type: 'b2b', employees: 20, outbound_marketer_detected: true })).exclusion_reason,
    'outbound_marketer_detected',
  );

  assert.equal(
    scoreColdEmail(
      base({
        b2b_type: 'b2b',
        primary_buyer: 'business',
        customer_geo: 'us',
        employees: 40,
        live_site: false,
      }),
    ).exclusion_reason,
    'below_min_score',
  );

  const hybrid = scoreColdEmail(
    base({
      b2b_type: 'hybrid',
      primary_buyer: 'business',
      customer_geo: 'us',
      employees: 40,
      revenue_est: 800_000,
      live_site: true,
      named_dm_discoverable: true,
    }),
  );
  const b2b = scoreColdEmail(
    base({
      b2b_type: 'b2b',
      primary_buyer: 'business',
      customer_geo: 'us',
      employees: 40,
      revenue_est: 800_000,
      live_site: true,
      named_dm_discoverable: true,
    }),
  );
  assert.equal(hybrid.qualified, true);
  assert.equal(b2b.qualified, true);
  assert.ok((b2b.score ?? 0) - (hybrid.score ?? 0) === 10);
});

test('search band 11-50 counts as mid-size when employees is missing', () => {
  assert.equal(searchBandIsMidSize('11,20'), true);
  assert.equal(searchBandIsMidSize('21,50'), true);
  assert.equal(searchBandIsMidSize('1,10'), false);
  assert.equal(searchBandIsMidSize(''), false);

  const withoutBand = scoreColdEmail(
    base({
      b2b_type: 'b2b',
      primary_buyer: 'business',
      customer_geo: 'us',
      employees: null,
      live_site: true,
    }),
  );
  assert.equal(withoutBand.qualified, false);
  assert.equal(withoutBand.exclusion_reason, 'below_min_score');

  const withBand = scoreColdEmail(
    base({
      b2b_type: 'b2b',
      primary_buyer: 'business',
      customer_geo: 'us',
      employees: null,
      search_employee_band: '21,50',
      live_site: true,
    }),
  );
  assert.equal(withBand.qualified, true);
  assert.equal(withBand.score, 40);
});

test('webinar scoring and gates', () => {
  const good = scoreWebinar(
    base({
      runs_webinars: 0.8,
      webinar_purpose: 'sales_pipeline',
      webinar_cadence: 'recurring',
      has_registration_page: true,
      audience_is_ce_profession: true,
      audience_nameable: true,
      wants_more_attendance: true,
      has_sales_motion: true,
      webinar_role_detected: false,
    }),
  );
  assert.equal(good.qualified, true);
  assert.equal(good.score, 15 + 15 + 10 + 25 + 10 + 10 + 8 + 7);

  assert.equal(scoreWebinar(base({ runs_webinars: 0.2 })).qualified, false);
  assert.equal(
    scoreWebinar(base({ runs_webinars: 0.8, webinar_purpose: 'customer_training', webinar_cadence: 'recurring' }))
      .exclusion_reason,
    'training_or_unknown_purpose',
  );
  assert.equal(
    scoreWebinar(
      base({
        runs_webinars: 0.8,
        webinar_purpose: 'sales_pipeline',
        webinar_cadence: 'recurring',
        webinar_role_detected: true,
      }),
    ).exclusion_reason,
    'webinar_role_detected',
  );
});

test('routing uses proof weights not raw argmax', () => {
  const routed = routeCompany([
    {
      company_id: 'x',
      door: 'cold_email',
      qualified: true,
      score: 80,
      exclusion_reason: '',
      routing_score: 80,
    },
    {
      company_id: 'x',
      door: 'webinar',
      qualified: true,
      score: 72,
      exclusion_reason: '',
      routing_score: 72 * 1.15,
    },
  ]);
  assert.equal(routed.primary_door, 'webinar');
  assert.equal(routed.secondary_door, 'cold_email');
});
