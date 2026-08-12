import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyConsumerTargeted } from './consumerFilter.js';

describe('classifyConsumerTargeted', () => {
  it('flags parenting / pet / psychic consumer webinars', () => {
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'Alexdoesparenting',
        ad_copy: 'Parents of autistic and developmentally delayed children, this free webinar…',
      }).is_consumer,
      true,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'BADCO',
        ad_copy: 'Big dogs are a lifestyle. The Big Ass Dog Summit…',
      }).is_consumer,
      true,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'John Edward',
        ad_copy: 'Psychic Medium John Edward – LIVE…',
      }).is_consumer,
      true,
    );
  });

  it('flags patient / retiree / TK-12 consumer leftovers', () => {
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'Carolinas Natural Health Center',
        ad_copy:
          'Real Answers To Your Health Issues! If you’ve been told symptoms like stubborn weight, brain fog…',
      }).is_consumer,
      true,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'National Retirement Foundation',
        ad_copy: 'discover step-by-step strategies that could help lower your retirement tax bill',
      }).is_consumer,
      true,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'iLEAD Exploration',
        ad_copy: 'Prospective Family Webinars. A FREE TK-12 independent study program for your family',
      }).is_consumer,
      true,
    );
  });

  it('keeps clear B2B / professional CE', () => {
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'Kitces.com',
        ad_copy: 'Calling all IARs and CFPs! Need to fulfill your IAR Ethics CE requirements?',
      }).is_consumer,
      false,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'Barkley & Associates',
        ad_copy: 'Level up your pediatric care knowledge. Join our PNP-PC Live Webinar for clinicians.',
      }).is_consumer,
      false,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'ACT Leadership',
        ad_copy:
          'Our Leadership Equation Advanced Coaching Program (LEAP). ICF-accredited at the PCC / Level 2',
      }).is_consumer,
      false,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'Early Life Nutrition Alliance',
        ad_copy:
          'Join this free expert-led webinar for dietitians exploring nutrition across the surrogacy journey for intended parents',
      }).is_consumer,
      false,
    );
    assert.equal(
      classifyConsumerTargeted({
        company_name: 'The Child Led SLP',
        ad_copy:
          'for SLPs, OTs, educators. What to say when people doubt your child-led approach',
      }).is_consumer,
      false,
    );
  });
});
