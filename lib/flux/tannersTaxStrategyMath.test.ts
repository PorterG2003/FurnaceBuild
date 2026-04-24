import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTannersTaxScenarioNumbers,
  canShowW2OffsetIllustration,
  computeW2OffsetIllustration,
} from './tannersTaxStrategyMath.js';

test('PDF anchor example: $500k purchase, $150k land, 37% marginal', () => {
  const r = computeTannersTaxScenarioNumbers({
    purchasePrice: 500_000,
    landValue: 150_000,
    marginalTaxRatePercent: 37,
  });
  assert.ok(r);
  assert.equal(r.depreciableBuilding, 350_000);
  assert.equal(r.standardAnnualDeduction, 12_727);
  assert.equal(r.costSeg25YearOneDeduction, 87_500);
  assert.equal(r.costSeg30YearOneDeduction, 105_000);
  assert.equal(r.estimatedTaxImpactStandard, 4709);
  assert.equal(r.estimatedTaxImpactCostSeg25, 32_375);
  assert.equal(r.estimatedTaxImpactCostSeg30, 38_850);
});

test('W-2 offset illustration matches PDF ($400k W-2, $105k loss, 37%)', () => {
  const ill = computeW2OffsetIllustration({
    w2Income: 400_000,
    yearOneDeduction: 105_000,
    marginalRateDecimal: 0.37,
  });
  assert.ok(ill);
  assert.equal(ill.usableLoss, 105_000);
  assert.equal(ill.taxableIncomeAfter, 295_000);
  assert.equal(ill.estimatedTaxImpactFromLoss, 38_850);
});

test('passive mode does not qualify for W-2 offset illustration', () => {
  assert.equal(canShowW2OffsetIllustration('passive'), false);
});

test('reps and str qualify for W-2 offset illustration', () => {
  assert.equal(canShowW2OffsetIllustration('reps'), true);
  assert.equal(canShowW2OffsetIllustration('str'), true);
});

test('computeTannersTaxScenarioNumbers returns null when land >= purchase', () => {
  assert.equal(
    computeTannersTaxScenarioNumbers({
      purchasePrice: 100_000,
      landValue: 100_000,
      marginalTaxRatePercent: 37,
    }),
    null,
  );
});

test('W-2 offset caps loss when W-2 is smaller than deduction', () => {
  const ill = computeW2OffsetIllustration({
    w2Income: 50_000,
    yearOneDeduction: 105_000,
    marginalRateDecimal: 0.37,
  });
  assert.ok(ill);
  assert.equal(ill.usableLoss, 50_000);
  assert.equal(ill.taxableIncomeAfter, 0);
  assert.equal(ill.estimatedTaxImpactFromLoss, 18_500);
});
