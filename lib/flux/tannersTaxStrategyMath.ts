/**
 * Illustrative depreciation / cost-seg figures aligned with the leave-behind PDF
 * (residential rental 27.5-year straight-line; cost seg 25% / 30% of depreciable basis in Year 1).
 * Not tax advice — UI must show disclaimers.
 */

import type { TannersTaxQualificationMode } from './types.js';

export type { TannersTaxQualificationMode };

const RESIDENTIAL_RECOVERY_YEARS = 27.5;
const COST_SEG_YEAR1_LOW = 0.25;
const COST_SEG_YEAR1_HIGH = 0.3;

export interface TannersTaxScenarioInput {
  purchasePrice: number;
  landValue: number;
  /** e.g. 37 for 37% */
  marginalTaxRatePercent: number;
}

export interface TannersTaxScenarioNumbers {
  depreciableBuilding: number;
  standardAnnualDeduction: number;
  costSeg25YearOneDeduction: number;
  costSeg30YearOneDeduction: number;
  marginalRateDecimal: number;
  estimatedTaxImpactStandard: number;
  estimatedTaxImpactCostSeg25: number;
  estimatedTaxImpactCostSeg30: number;
}

function roundMoney(n: number): number {
  return Math.round(n);
}

/**
 * Returns computed scenario numbers, or null if inputs are invalid (e.g. land ≥ purchase).
 */
export function computeTannersTaxScenarioNumbers(
  input: TannersTaxScenarioInput,
): TannersTaxScenarioNumbers | null {
  const { purchasePrice, landValue, marginalTaxRatePercent } = input;
  if (!Number.isFinite(purchasePrice) || !Number.isFinite(landValue) || !Number.isFinite(marginalTaxRatePercent)) {
    return null;
  }
  if (purchasePrice < 0 || landValue < 0 || marginalTaxRatePercent < 0 || marginalTaxRatePercent > 100) {
    return null;
  }
  const depreciable = purchasePrice - landValue;
  if (depreciable <= 0) return null;

  const rate = marginalTaxRatePercent / 100;
  const standardAnnual = roundMoney(depreciable / RESIDENTIAL_RECOVERY_YEARS);
  const cs25 = roundMoney(depreciable * COST_SEG_YEAR1_LOW);
  const cs30 = roundMoney(depreciable * COST_SEG_YEAR1_HIGH);

  return {
    depreciableBuilding: roundMoney(depreciable),
    standardAnnualDeduction: standardAnnual,
    costSeg25YearOneDeduction: cs25,
    costSeg30YearOneDeduction: cs30,
    marginalRateDecimal: rate,
    estimatedTaxImpactStandard: roundMoney(standardAnnual * rate),
    estimatedTaxImpactCostSeg25: roundMoney(cs25 * rate),
    estimatedTaxImpactCostSeg30: roundMoney(cs30 * rate),
  };
}

/** W-2 offset illustration only when household qualifies under REPS or STR (per PDF framing). */
export function canShowW2OffsetIllustration(mode: TannersTaxQualificationMode): boolean {
  return mode === 'reps' || mode === 'str';
}

export interface W2OffsetIllustration {
  usableLoss: number;
  taxableIncomeAfter: number;
  estimatedTaxImpactFromLoss: number;
}

/**
 * Illustrates offsetting W-2 with Year-1 paper loss when eligible; caps loss used at W-2 amount.
 */
export function computeW2OffsetIllustration(params: {
  w2Income: number;
  yearOneDeduction: number;
  marginalRateDecimal: number;
}): W2OffsetIllustration | null {
  const { w2Income, yearOneDeduction, marginalRateDecimal } = params;
  if (!Number.isFinite(w2Income) || w2Income < 0) return null;
  if (!Number.isFinite(yearOneDeduction) || yearOneDeduction < 0) return null;
  if (!Number.isFinite(marginalRateDecimal) || marginalRateDecimal < 0 || marginalRateDecimal > 1) return null;

  const usableLoss = Math.min(w2Income, yearOneDeduction);
  const taxableIncomeAfter = Math.max(0, w2Income - usableLoss);
  const estimatedTaxImpactFromLoss = roundMoney(usableLoss * marginalRateDecimal);
  return { usableLoss, taxableIncomeAfter, estimatedTaxImpactFromLoss };
}
