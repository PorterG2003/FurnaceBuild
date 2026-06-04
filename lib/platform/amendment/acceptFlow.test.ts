import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPendingAmendmentStatus,
  resolveAmendmentAcceptFlow,
  resolveAmendmentBillingChangeKind,
} from './acceptFlow';

describe('resolveAmendmentAcceptFlow', () => {
  const base = {
    monthly_retainer_cents: 300000,
    agreement_type: 'managed_services_agreement' as const,
    proposal_snapshot_json: {
      plan_tier: 'silver',
      proposal_title: 'Silver',
      managed_outreach_volume: 5000,
      managed_inbox_count: 25,
      website_traffic_sourcing_enabled: true,
      reply_handling_enabled: true,
    },
  };

  it('returns terms_only when only terms-related fields differ in snapshot comparison', () => {
    const proposed = {
      ...base,
      proposal_snapshot_json: { ...base.proposal_snapshot_json },
    };
    assert.equal(resolveAmendmentAcceptFlow(base, proposed), 'terms_only');
  });

  it('returns full_proposal when retainer changes', () => {
    assert.equal(
      resolveAmendmentAcceptFlow(base, { ...base, monthly_retainer_cents: 400000 }),
      'full_proposal',
    );
  });

  it('returns full_proposal when plan tier changes', () => {
    assert.equal(
      resolveAmendmentAcceptFlow(base, {
        ...base,
        proposal_snapshot_json: { ...base.proposal_snapshot_json, plan_tier: 'gold' },
      }),
      'full_proposal',
    );
  });

  it('returns terms_only when both snapshots omit plan_tier', () => {
    const withoutTier = {
      ...base,
      proposal_snapshot_json: {
        proposal_title: 'Silver',
        managed_outreach_volume: 5000,
        managed_inbox_count: 25,
        website_traffic_sourcing_enabled: true,
        reply_handling_enabled: true,
      },
    };
    assert.equal(resolveAmendmentAcceptFlow(withoutTier, withoutTier), 'terms_only');
  });

  it('returns full_proposal when one snapshot has plan_tier and the other omits it', () => {
    const current = base;
    const proposed = {
      ...base,
      proposal_snapshot_json: {
        proposal_title: 'Silver',
        managed_outreach_volume: 5000,
        managed_inbox_count: 25,
        website_traffic_sourcing_enabled: true,
        reply_handling_enabled: true,
      },
    };
    assert.equal(resolveAmendmentAcceptFlow(current, proposed), 'full_proposal');
  });
});

describe('resolveAmendmentBillingChangeKind', () => {
  const base = {
    monthly_retainer_cents: 300000,
    agreement_type: 'managed_services_agreement' as const,
    proposal_snapshot_json: {},
  };

  it('returns unchanged when the retainer does not change', () => {
    assert.equal(resolveAmendmentBillingChangeKind(base, base), 'unchanged');
  });

  it('returns upgrade when the retainer increases', () => {
    assert.equal(
      resolveAmendmentBillingChangeKind(base, {
        ...base,
        monthly_retainer_cents: 450000,
      }),
      'upgrade',
    );
  });

  it('returns downgrade when the retainer decreases', () => {
    assert.equal(
      resolveAmendmentBillingChangeKind(base, {
        ...base,
        monthly_retainer_cents: 225000,
      }),
      'downgrade',
    );
  });
});

describe('isPendingAmendmentStatus', () => {
  it('accepts pending amendment states', () => {
    assert.equal(isPendingAmendmentStatus('pending_acceptance'), true);
    assert.equal(isPendingAmendmentStatus('pending_payment'), true);
  });

  it('rejects terminal states', () => {
    assert.equal(isPendingAmendmentStatus('accepted'), false);
    assert.equal(isPendingAmendmentStatus(null), false);
  });
});
