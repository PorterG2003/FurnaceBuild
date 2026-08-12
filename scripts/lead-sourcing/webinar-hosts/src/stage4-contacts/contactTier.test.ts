import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyContactTier, pickContactSlots, isPosterEligible, isValidPosterContact } from './contactTier.js';
import type { ContactTiersConfig } from '../lib/config.js';
import { loadIcpConfig } from '../lib/config.js';

const tiers: ContactTiersConfig = loadIcpConfig().contact_search.contact_tiers;

describe('classifyContactTier', () => {
  it('classifies webinar marketing roles as tier 1', () => {
    assert.equal(classifyContactTier('Director of Marketing', tiers), 'webinar_fill');
    assert.equal(classifyContactTier('CMO', tiers), 'webinar_fill');
    assert.equal(classifyContactTier('VP Marketing', tiers), 'webinar_fill');
  });

  it('classifies pipeline leadership as tier 2', () => {
    assert.equal(classifyContactTier('VP Sales', tiers), 'pipeline');
    assert.equal(classifyContactTier('Chief Revenue Officer', tiers), 'pipeline');
    assert.equal(classifyContactTier('Director of Business Development', tiers), 'pipeline');
  });

  it('excludes IC sales roles entirely', () => {
    assert.equal(classifyContactTier('Account Executive', tiers), 'excluded');
    assert.equal(classifyContactTier('Founding Account Executive', tiers), 'excluded');
    assert.equal(classifyContactTier('SDR', tiers), 'excluded');
    assert.equal(classifyContactTier('BDR', tiers), 'excluded');
  });

  it('does not classify plain sales IC as tier 2', () => {
    assert.equal(classifyContactTier('Sales Manager', tiers), 'unknown');
  });

  it('classifies company owners as tier 3', () => {
    assert.equal(classifyContactTier('Co-founder & CEO', tiers), 'executive');
    assert.equal(classifyContactTier('Chief Executive Officer', tiers), 'executive');
    assert.equal(classifyContactTier('Executive Director', tiers), 'executive');
    assert.equal(classifyContactTier('President', tiers), 'executive');
  });

  it('classifies commercial pipeline roles', () => {
    assert.equal(classifyContactTier('Head of Commercial Development', tiers), 'pipeline');
  });

  it('does not classify bare communications titles as tier 1', () => {
    assert.equal(classifyContactTier('Communications Manager', tiers), 'unknown');
    assert.equal(classifyContactTier('Senior Communications Coordinator', tiers), 'unknown');
    assert.equal(classifyContactTier('Director of Strategy and Communications', tiers), 'unknown');
  });

  it('does not classify vice president alone as tier 3', () => {
    assert.equal(classifyContactTier('Vice President', tiers), 'unknown');
    assert.equal(classifyContactTier('VP Operations', tiers), 'unknown');
  });

  it('excludes customer success', () => {
    assert.equal(classifyContactTier('Head of Customer Success', tiers), 'excluded');
    assert.equal(classifyContactTier('Head of Customer Partnerships', tiers), 'excluded');
  });
});

describe('pickContactSlots', () => {
  it('picks tier1 then tier3 when mixed', () => {
    const slots = pickContactSlots(
      [
        { id: 'cs', title: 'Head of Customer Success', has_email: true },
        { id: 'ceo', title: 'Co-founder & CEO', has_email: true },
        { id: 'mkt', title: 'Marketing Associate', has_email: true },
      ],
      2,
      tiers,
    );
    assert.deepEqual(
      slots.map((slot) => slot.id),
      ['mkt', 'ceo'],
    );
    assert.equal(slots[0]!.tier, 'webinar_fill');
    assert.equal(slots[1]!.tier, 'executive');
  });

  it('picks two tier1 contacts when available', () => {
    const slots = pickContactSlots(
      [
        { id: 'events', title: 'Director of Events', has_email: true },
        { id: 'demand', title: 'Demand Gen Manager', has_email: true },
      ],
      2,
      tiers,
    );
    assert.equal(slots.length, 2);
    assert.ok(slots.every((slot) => slot.tier === 'webinar_fill'));
  });

  it('picks VP Sales over excluded AE and SDR', () => {
    const slots = pickContactSlots(
      [
        { id: 'ae', title: 'Account Executive', has_email: true },
        { id: 'sdr', title: 'SDR', has_email: true },
        { id: 'vp', title: 'VP Sales', has_email: true },
      ],
      2,
      tiers,
    );
    assert.deepEqual(
      slots.map((slot) => slot.id),
      ['vp'],
    );
  });

  it('picks CEO over founding account executive', () => {
    const slots = pickContactSlots(
      [
        { id: 'fae', title: 'Founding Account Executive', has_email: true },
        { id: 'ceo', title: 'Co-founder & CEO', has_email: true },
      ],
      2,
      tiers,
    );
    assert.deepEqual(
      slots.map((slot) => slot.id),
      ['ceo'],
    );
  });

  it('matches Ruli-like pool', () => {
    const slots = pickContactSlots(
      [
        { id: 'partnerships', title: 'Head of Customer Partnerships', has_email: true },
        { id: 'ceo', title: 'Co-founder & CEO', has_email: true },
        { id: 'mkt', title: 'Marketing Associate', has_email: true },
      ],
      2,
      tiers,
    );
    assert.deepEqual(
      slots.map((slot) => slot.id),
      ['mkt', 'ceo'],
    );
  });

  it('reserves poster slot then fills from org pool', () => {
    const slots = pickContactSlots(
      [{ id: 'mkt', title: 'Director of Marketing', has_email: true }],
      2,
      tiers,
      { posterId: 'poster-1', posterTitle: 'Webinar Host' },
    );
    assert.deepEqual(
      slots.map((slot) => [slot.id, slot.tier]),
      [
        ['poster-1', 'poster'],
        ['mkt', 'webinar_fill'],
      ],
    );
  });
});

describe('isPosterEligible', () => {
  it('returns true for person_employer', () => {
    assert.equal(
      isPosterEligible(
        { entity_source: 'person_employer', sample_post_url: 'https://example.com/post' },
        new Map(),
      ),
      true,
    );
  });

  it('returns true when stage2 author is a LinkedIn profile', () => {
    const url = 'https://example.com/post';
    assert.equal(
      isPosterEligible(
        { entity_source: 'serp_fallback', sample_post_url: url },
        new Map([[url, 'https://www.linkedin.com/in/jane-doe/']]),
      ),
      true,
    );
  });
});

describe('isValidPosterContact', () => {
  it('rejects excluded poster titles', () => {
    assert.equal(
      isValidPosterContact('Head of Sales and Marketing - Human Resources & Employment Law Support', tiers),
      false,
    );
    assert.equal(isValidPosterContact('Head of Customer Success', tiers), false);
  });

  it('accepts GTM-relevant poster titles', () => {
    assert.equal(isValidPosterContact('CEO & Founder', tiers), true);
    assert.equal(isValidPosterContact('Head of Partner Marketing', tiers), true);
    assert.equal(isValidPosterContact('Project Manager', tiers), true);
  });
});
