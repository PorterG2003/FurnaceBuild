import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import type { TannersTaxQualificationMode, TannersTaxStrategyBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { handleFluxCtaPress } from '@/lib/flux/fluxCtaNavigation';
import { useFluxPageScroll } from '../FluxPageScrollContext';
import { withFluxAlpha } from '@/lib/flux/fluxPresentationTokens';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';
import {
  computeTannersTaxScenarioNumbers,
  canShowW2OffsetIllustration,
  computeW2OffsetIllustration,
} from '@/lib/flux/tannersTaxStrategyMath';

type OffsetScenarioKey = 'standard' | 'costSeg25' | 'costSeg30';

function parseMoneyInput(raw: string): number {
  const n = parseFloat(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

const QUALIFICATION_OPTIONS: { value: TannersTaxQualificationMode; label: string }[] = [
  { value: 'passive', label: 'Passive rental' },
  { value: 'reps', label: 'REPS' },
  { value: 'str', label: 'STR' },
];

const OFFSET_SCENARIO_OPTIONS: { value: OffsetScenarioKey; label: string }[] = [
  { value: 'standard', label: 'Standard (27.5 yr)' },
  { value: 'costSeg25', label: 'Cost seg 25%' },
  { value: 'costSeg30', label: 'Cost seg 30%' },
];

export function TannersTaxStrategyBlock({ props }: { props: TannersTaxStrategyBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const pageScroll = useFluxPageScroll();
  const mutedStyle = {
    color: theme.textColor,
    opacity: presentation.mutedTextOpacity,
    fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
  };

  const [purchaseStr, setPurchaseStr] = useState(String(props.defaultPurchasePrice ?? 500_000));
  const [landStr, setLandStr] = useState(String(props.defaultLandValue ?? 150_000));
  const [taxPercentStr, setTaxPercentStr] = useState(String(props.defaultMarginalTaxPercent ?? 37));
  const [w2Str, setW2Str] = useState('');
  const [qualification, setQualification] = useState<TannersTaxQualificationMode>(
    props.defaultQualificationMode ?? 'passive',
  );
  const [offsetScenario, setOffsetScenario] = useState<OffsetScenarioKey>('costSeg30');

  const purchase = parseMoneyInput(purchaseStr);
  const land = parseMoneyInput(landStr);
  const taxPercent = parseMoneyInput(taxPercentStr);
  const w2Income = w2Str.trim() === '' ? NaN : parseMoneyInput(w2Str);

  const numbers = useMemo(() => {
    if (!Number.isFinite(purchase) || !Number.isFinite(land) || !Number.isFinite(taxPercent)) return null;
    return computeTannersTaxScenarioNumbers({
      purchasePrice: purchase,
      landValue: land,
      marginalTaxRatePercent: taxPercent,
    });
  }, [purchase, land, taxPercent]);

  const yearOneForOffset = numbers
    ? offsetScenario === 'standard'
      ? numbers.standardAnnualDeduction
      : offsetScenario === 'costSeg25'
        ? numbers.costSeg25YearOneDeduction
        : numbers.costSeg30YearOneDeduction
    : 0;

  const w2Illustration =
    numbers &&
    canShowW2OffsetIllustration(qualification) &&
    Number.isFinite(w2Income) &&
    w2Income > 0
      ? computeW2OffsetIllustration({
          w2Income,
          yearOneDeduction: yearOneForOffset,
          marginalRateDecimal: numbers.marginalRateDecimal,
        })
      : null;

  const inputClass = 'px-3 py-2 text-sm mb-2 w-full';
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const complexLayout = presentation.layouts.complex;
  const innerFrameStyle = complexLayout === 'soft' ? presentation.tintedCard : undefined;
  const headingAlignClass = complexLayout === 'cards' || complexLayout === 'soft' ? 'text-center' : 'text-left';
  const sectionLabel =
    complexLayout === 'dashboard'
      ? 'Interactive model'
      : complexLayout === 'editorial'
        ? 'Scenario notes'
        : 'Strategy calculator';
  const workingCardStyle = complexLayout === 'dashboard' ? presentation.strongCard : presentation.card;

  return (
    <View
      className={complexLayout === 'dashboard' ? 'w-full py-14 px-4 md:px-8 items-center' : 'w-full py-12 px-6 items-center'}
      style={{ backgroundColor: theme.backgroundColor }}
    >
      <View
        className={
          complexLayout === 'dashboard'
            ? 'w-full max-w-5xl'
            : complexLayout === 'editorial'
              ? 'w-full max-w-4xl'
              : 'w-full max-w-3xl'
        }
        style={innerFrameStyle}
      >
        <Text className={`text-xs uppercase tracking-[3px] mb-3 ${headingAlignClass}`} style={{ color: theme.primaryColor, fontFamily: headingFont }}>
          {sectionLabel}
        </Text>
        <Text
          className={`text-2xl md:text-4xl mb-2 ${headingAlignClass}`}
          style={{ color: theme.textColor, fontFamily: headingFont }}
        >
          {props.heading}
        </Text>
        {props.subheadline ? (
          <Text
            className={`text-base mb-6 leading-6 ${headingAlignClass}`}
            style={mutedStyle}
          >
            {props.subheadline}
          </Text>
        ) : null}

        <View className="p-4 md:p-5 mb-4" style={workingCardStyle}>
          <Text
            className="text-xs uppercase tracking-wide mb-2"
            style={{
              color: theme.textColor,
              opacity: presentation.mutedTextOpacity,
              fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
            }}
          >
            Your inputs
          </Text>
          <Text className="text-xs mb-1" style={mutedStyle}>Purchase price</Text>
          <TextInput
            className={inputClass}
            style={{
              ...presentation.input,
              color: theme.textColor,
              fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
            }}
            keyboardType="decimal-pad"
            value={purchaseStr}
            onChangeText={setPurchaseStr}
            placeholder="500000"
            placeholderTextColor="#999"
          />
          <Text className="text-xs mb-1" style={mutedStyle}>Land value (not depreciated)</Text>
          <TextInput
            className={inputClass}
            style={{
              ...presentation.input,
              color: theme.textColor,
              fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
            }}
            keyboardType="decimal-pad"
            value={landStr}
            onChangeText={setLandStr}
            placeholder="150000"
            placeholderTextColor="#999"
          />
          <Text className="text-xs mb-1" style={mutedStyle}>Marginal tax rate (%)</Text>
          <TextInput
            className={inputClass}
            style={{
              ...presentation.input,
              color: theme.textColor,
              fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
            }}
            keyboardType="decimal-pad"
            value={taxPercentStr}
            onChangeText={setTaxPercentStr}
            placeholder="37"
            placeholderTextColor="#999"
          />

          <Text className="text-xs mb-2 mt-3" style={mutedStyle}>Qualification (for W-2 illustration)</Text>
          <View className="flex-row flex-wrap gap-2 mb-2">
            {QUALIFICATION_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                className="px-3 py-2"
                style={{
                  borderRadius: presentation.radii.chip,
                  borderWidth: 1,
                  borderColor: qualification === opt.value ? theme.primaryColor : '#e5e5e5',
                  backgroundColor:
                    qualification === opt.value
                      ? withFluxAlpha(theme.primaryColor, '18')
                      : presentation.surfaceColor,
                }}
                onPress={() => setQualification(opt.value)}
              >
                <Text
                  className="text-xs"
                  style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {qualification === 'passive' ? (
            <Text className="text-xs leading-5 mb-2" style={mutedStyle}>
              By default, rental losses are generally passive: they typically offset rental income first, not W-2
              wages, unless you qualify under rules such as REPS or a qualifying STR. Figures below are illustrative
              deductions and estimated tax impact at your entered rate — not a guarantee of usable savings against
              your paycheck.
            </Text>
          ) : (
            <Text className="text-xs leading-5 mb-2" style={mutedStyle}>
              REPS / STR framing: the PDF illustrates how qualifying households may use real estate paper losses
              against combined income (including W-2) when rules are met. This tool does not verify hours or material
              participation — consult a tax professional.
            </Text>
          )}

          <Text className="text-xs mb-1" style={mutedStyle}>W-2 income (optional)</Text>
          <TextInput
            className={inputClass}
            style={{
              ...presentation.input,
              color: theme.textColor,
              fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400'),
            }}
            keyboardType="decimal-pad"
            value={w2Str}
            onChangeText={setW2Str}
            placeholder="e.g. 400000"
            placeholderTextColor="#999"
          />

          {canShowW2OffsetIllustration(qualification) && numbers ? (
            <>
              <Text className="text-xs mb-2 mt-2" style={mutedStyle}>W-2 offset uses Year 1 deduction from</Text>
              <View className="flex-row flex-wrap gap-2">
                {OFFSET_SCENARIO_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    className="px-2 py-1.5"
                    style={{
                      borderRadius: presentation.radii.chip,
                      borderWidth: 1,
                      borderColor: offsetScenario === opt.value ? theme.primaryColor : '#e5e5e5',
                      backgroundColor:
                        offsetScenario === opt.value
                          ? withFluxAlpha(theme.primaryColor, '18')
                          : presentation.surfaceColor,
                    }}
                    onPress={() => setOffsetScenario(opt.value)}
                  >
                    <Text className="text-xs" style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>

        {!numbers ? (
          <Text className="text-center text-sm" style={mutedStyle}>
            Enter valid numbers (purchase must exceed land value; tax rate 0–100%).
          </Text>
        ) : (
          <>
            <View className="p-4 md:p-5 mb-4" style={presentation.card}>
              <Text className="text-sm mb-3" style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>
                Depreciable building: {formatUsd(numbers.depreciableBuilding)}
              </Text>
              <View className="border-t border-[#eee] pt-3 gap-2">
                <View className="flex-row justify-between flex-wrap">
                  <Text className="text-xs flex-1 pr-2" style={mutedStyle}>
                    Standard — annual (27.5 yr)
                  </Text>
                  <Text className="text-xs" style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>
                    {formatUsd(numbers.standardAnnualDeduction)} / yr · est. {formatUsd(numbers.estimatedTaxImpactStandard)}{' '}
                    tax impact
                  </Text>
                </View>
                <View className="flex-row justify-between flex-wrap">
                  <Text className="text-xs flex-1 pr-2" style={mutedStyle}>
                    Cost seg — 25% of building (Year 1)
                  </Text>
                  <Text className="text-xs" style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>
                    {formatUsd(numbers.costSeg25YearOneDeduction)} · est. {formatUsd(numbers.estimatedTaxImpactCostSeg25)}
                  </Text>
                </View>
                <View className="flex-row justify-between flex-wrap">
                  <Text className="text-xs flex-1 pr-2" style={mutedStyle}>
                    Cost seg — 30% of building (Year 1)
                  </Text>
                  <Text className="text-xs" style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>
                    {formatUsd(numbers.costSeg30YearOneDeduction)} · est. {formatUsd(numbers.estimatedTaxImpactCostSeg30)}
                  </Text>
                </View>
              </View>
            </View>

            {w2Illustration ? (
              <View className="p-4 md:p-5 mb-4" style={presentation.strongCard}>
                <Text className="text-sm mb-2" style={{ color: theme.primaryColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>
                  W-2 offset illustration
                </Text>
                <Text className="text-xs mb-2" style={mutedStyle}>
                  Using {OFFSET_SCENARIO_OPTIONS.find((o) => o.value === offsetScenario)?.label}: loss{' '}
                  {formatUsd(yearOneForOffset)} vs W-2 {formatUsd(w2Income)} at {taxPercent}% marginal (illustrative).
                </Text>
                <Text className="text-sm" style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}>
                  Taxable income after offset: ~{formatUsd(w2Illustration.taxableIncomeAfter)}
                </Text>
                <Text className="text-sm mt-1" style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}>
                  Estimated tax impact from usable loss: ~{formatUsd(w2Illustration.estimatedTaxImpactFromLoss)}
                </Text>
              </View>
            ) : null}

          </>
        )}

        <Text className="text-xs leading-5 mb-4" style={mutedStyle}>
          {props.disclaimer}
        </Text>

        {props.ctaText && props.ctaUrl ? (
          <Pressable
            className={complexLayout === 'editorial' ? 'px-6 py-3 self-start' : 'px-6 py-3 self-center'}
            style={presentation.primaryButton}
            onPress={() => props.ctaUrl && handleFluxCtaPress(props.ctaUrl, pageScroll ?? undefined)}
          >
            <Text
              className="text-base"
              style={{
                color: presentation.onPrimaryColor,
                fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600'),
              }}
            >
              {props.ctaText}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
