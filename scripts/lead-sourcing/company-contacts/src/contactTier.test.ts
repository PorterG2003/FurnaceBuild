import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadIcpConfig } from './config.js';
import {
  classifyContactTier,
  passesTitleAccuracy,
  pickContactSlots,
} from './contactTier.js';

const searchConfig = loadIcpConfig().contact_search;
const tiers = searchConfig.contact_tiers;

describe('classifyContactTier', () => {
  it('classifies founder/CEO as executive', () => {
    assert.equal(classifyContactTier('CEO & Co-Founder', tiers), 'executive');
    assert.equal(classifyContactTier('Founder', tiers), 'executive');
    assert.equal(classifyContactTier('Chief Executive Officer', tiers), 'executive');
    assert.equal(classifyContactTier('President', tiers), 'executive');
  });

  it('does not treat vice president as president', () => {
    assert.notEqual(classifyContactTier('Vice President of Sales', tiers), 'executive');
  });

  it('rejects President of <department> as executive', () => {
    assert.equal(classifyContactTier('President of Business Development', tiers), 'unknown');
    assert.equal(
      passesTitleAccuracy('President of Business Development', 'executive', tiers),
      false,
    );
  });

  it('rejects board member and franchise owner', () => {
    assert.equal(classifyContactTier('Board Member', tiers), 'excluded');
    assert.equal(classifyContactTier('Franchise Owner', tiers), 'excluded');
  });

  it('classifies sales/marketing leaders as sales_marketing', () => {
    assert.equal(classifyContactTier('VP of Sales', tiers), 'sales_marketing');
    assert.equal(classifyContactTier('Vice President of Marketing', tiers), 'sales_marketing');
    assert.equal(classifyContactTier('Head of Growth', tiers), 'sales_marketing');
    assert.equal(classifyContactTier('CMO', tiers), 'sales_marketing');
    assert.equal(classifyContactTier('Chief Marketing Officer', tiers), 'sales_marketing');
    assert.equal(classifyContactTier('CRO', tiers), 'sales_marketing');
    assert.equal(classifyContactTier('Director of Marketing', tiers), 'sales_marketing');
  });

  it('still classifies RevOps VP as revops (not in fill_order)', () => {
    assert.equal(classifyContactTier('VP of Revenue Operations', tiers), 'revops');
    assert.equal(classifyContactTier('Head of RevOps', tiers), 'revops');
  });

  it('excludes mid-level RevOps and junior sales/marketing', () => {
    assert.equal(classifyContactTier('Director of Revenue Operations', tiers), 'excluded');
    assert.equal(classifyContactTier('Revenue Operations Manager', tiers), 'excluded');
    assert.equal(classifyContactTier('Marketing Coordinator', tiers), 'excluded');
    assert.equal(classifyContactTier('Account Executive', tiers), 'excluded');
  });
});

describe('pickContactSlots', () => {
  it('prefers founder/CEO over VP Sales', () => {
    const slots = pickContactSlots(
      [
        {
          id: 'sales',
          title: 'VP of Sales',
          has_email: true,
        },
        {
          id: 'ceo',
          title: 'CEO',
          has_email: true,
        },
      ],
      searchConfig,
    );
    assert.equal(slots[0]?.id, 'ceo');
    assert.equal(slots[0]?.tier, 'executive');
    assert.equal(slots[1]?.id, 'sales');
    assert.equal(slots[1]?.tier, 'sales_marketing');
  });

  it('prefers CEO over President when both executive', () => {
    const slots = pickContactSlots(
      [
        { id: 'pres', title: 'President', has_email: true },
        { id: 'ceo', title: 'Chief Executive Officer', has_email: true },
      ],
      { ...searchConfig, max_contacts_per_company: 1 },
    );
    assert.equal(slots[0]?.id, 'ceo');
  });

  it('fills sales/marketing when no executive', () => {
    const slots = pickContactSlots(
      [
        {
          id: 'mid',
          title: 'Revenue Operations Manager',
          has_email: true,
        },
        {
          id: 'mkt',
          title: 'VP of Marketing',
          has_email: true,
        },
      ],
      searchConfig,
    );
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.id, 'mkt');
    assert.equal(slots[0]?.tier, 'sales_marketing');
  });

  it('skips mid-level RevOps and department presidents when filling', () => {
    const slots = pickContactSlots(
      [
        {
          id: 'mid',
          title: 'Revenue Operations Manager',
          has_email: true,
        },
        {
          id: 'bd',
          title: 'President of Business Development',
          has_email: true,
        },
        {
          id: 'ceo',
          title: 'Founder',
          has_email: true,
        },
      ],
      searchConfig,
    );
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.id, 'ceo');
  });
});
