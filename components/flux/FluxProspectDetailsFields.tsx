import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { FluxFontFamilyPicker } from '@/components/flux/FluxFontFamilyPicker';
import { FluxHexColorField } from '@/components/flux/FluxHexColorField';
import {
  FLUX_BLOCK_STYLE_PRESET_OPTIONS,
  type FluxBlockStylePreset,
} from '@/lib/flux/fluxPresentationTokens';

export interface FluxProspectDetailsFieldValues {
  name: string;
  company: string;
  role: string;
  url: string;
  industry: string;
  company_size: string;
  email_notes: string;
  brand_primaryColor: string;
  brand_accentColor: string;
  brand_fontFamily: string;
  brand_logoUrl: string;
  brand_blockStylePreset: FluxBlockStylePreset;
}

/** Prospect-row fields that can be copied into `PageConfig` (names + brand → theme). */
export type FluxProspectApplyToPageField =
  | 'name'
  | 'company'
  | 'brand_primaryColor'
  | 'brand_accentColor'
  | 'brand_fontFamily'
  | 'brand_blockStylePreset'
  | 'brand_logoUrl';

export type FluxProspectDetailsPartition = 'full' | 'prospect_only' | 'brand_only';

interface FluxProspectDetailsFieldsProps {
  values: FluxProspectDetailsFieldValues;
  onChange: (patch: Partial<FluxProspectDetailsFieldValues>) => void;
  /** Inserted after the Company URL field (e.g. website intel controls on new prospect). */
  belowCompanyUrlSlot?: React.ReactNode;
  inputClassName?: string;
  labelClassName?: string;
  /** Kept for call sites; section chrome uses `partition` and `hideSectionTitles`. */
  variant?: 'default' | 'embedded';
  /** Which field groups to render (default: both prospect scalars and brand when enabled). */
  partition?: FluxProspectDetailsPartition;
  /** When true, omit “Prospect details” / “Brand details” headings (parent supplies section chrome). */
  hideSectionTitles?: boolean;
  /** When false, hide colors / font / preset / logo. Default true (e.g. new prospect). */
  showBrandProfile?: boolean;
  /** Show a “Page” control to copy this row’s value into the page draft (prospect detail with a page only). */
  showApplyToPage?: boolean;
  onApplyFieldToPage?: (field: FluxProspectApplyToPageField) => void;
}

const DEFAULT_INPUT = 'text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm mb-3';
const DEFAULT_LABEL = 'text-gray-400 text-xs font-instrument mb-1';

const SECTION_HEADING =
  'text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold';

function ApplyToPageButton({
  field,
  show,
  onApply,
}: {
  field: FluxProspectApplyToPageField;
  show: boolean;
  onApply?: (field: FluxProspectApplyToPageField) => void;
}) {
  if (!show || !onApply) return null;
  return (
    <Pressable
      className="border border-[#444] rounded-lg px-2.5 py-2 shrink-0"
      onPress={() => onApply(field)}
      accessibilityRole="button"
      accessibilityLabel="Apply to page"
    >
      <Text className="text-indigo-300 text-xs font-instrument-semibold">Page</Text>
    </Pressable>
  );
}

export function FluxProspectDetailsFields({
  values,
  onChange,
  belowCompanyUrlSlot,
  inputClassName = DEFAULT_INPUT,
  labelClassName = DEFAULT_LABEL,
  partition = 'full',
  hideSectionTitles = false,
  showBrandProfile = true,
  showApplyToPage = false,
  onApplyFieldToPage,
}: FluxProspectDetailsFieldsProps) {
  const apply = showApplyToPage && !!onApplyFieldToPage;
  const inputNoBottomMb = inputClassName.replace(/\s*mb-\d+\s*/g, ' ').trim() + ' mb-0';

  const showProspectBlock = partition === 'full' || partition === 'prospect_only';
  const showBrandBlock =
    showBrandProfile && (partition === 'full' || partition === 'brand_only');

  return (
    <View>
      {showProspectBlock && !hideSectionTitles ? (
        <Text className={SECTION_HEADING}>Prospect details</Text>
      ) : null}
      {showProspectBlock ? (
        <>
      <Text className={labelClassName}>Contact Name *</Text>
      <View className="flex-row items-end gap-2 mb-2">
        <TextInput
          className={`${inputNoBottomMb} flex-1 min-w-0`}
          value={values.name}
          onChangeText={(value) => onChange({ name: value })}
          placeholder="Jane Smith"
          placeholderTextColor="#555"
        />
        <ApplyToPageButton field="name" show={apply} onApply={onApplyFieldToPage} />
      </View>
      <Text className={labelClassName}>Company *</Text>
      <View className="flex-row items-end gap-2 mb-2">
        <TextInput
          className={`${inputNoBottomMb} flex-1 min-w-0`}
          value={values.company}
          onChangeText={(value) => onChange({ company: value })}
          placeholder="Acme Corp"
          placeholderTextColor="#555"
        />
        <ApplyToPageButton field="company" show={apply} onApply={onApplyFieldToPage} />
      </View>
      <Text className={labelClassName}>Role</Text>
      <TextInput
        className={inputClassName}
        value={values.role}
        onChangeText={(value) => onChange({ role: value })}
        placeholder="VP of Sales"
        placeholderTextColor="#555"
      />
      <Text className={labelClassName}>Company URL</Text>
      <TextInput
        className={inputClassName}
        value={values.url}
        onChangeText={(value) => onChange({ url: value })}
        placeholder="https://acme.com"
        placeholderTextColor="#555"
        autoCapitalize="none"
      />
      {belowCompanyUrlSlot}
      <Text className={labelClassName}>Industry</Text>
      <TextInput
        className={inputClassName}
        value={values.industry}
        onChangeText={(value) => onChange({ industry: value })}
        placeholder="SaaS"
        placeholderTextColor="#555"
      />
      <Text className={labelClassName}>Company Size</Text>
      <TextInput
        className={inputClassName}
        value={values.company_size}
        onChangeText={(value) => onChange({ company_size: value })}
        placeholder="50-200"
        placeholderTextColor="#555"
      />
      <Text className={labelClassName}>Email Notes</Text>
      <TextInput
        className={`${inputClassName} min-h-[80px]`}
        value={values.email_notes}
        onChangeText={(value) => onChange({ email_notes: value })}
        placeholder="Paste relevant context from the email thread..."
        placeholderTextColor="#555"
        multiline
        textAlignVertical="top"
      />
        </>
      ) : null}

      {showBrandBlock ? (
        <>
          {!hideSectionTitles ? (
            <Text
              className={`${SECTION_HEADING}${
                partition === 'full' && showProspectBlock ? ' mt-4' : ''
              }`}
            >
              Brand details
            </Text>
          ) : null}
          <Text className={labelClassName}>Primary Color</Text>
          <View className="flex-row items-center gap-2 mb-2">
            <View className="flex-1 min-w-0">
              <FluxHexColorField
                value={values.brand_primaryColor}
                onChange={(hex) => onChange({ brand_primaryColor: hex })}
                placeholder="#4f46e5"
                fallbackHex="#4f46e5"
                swatchSize="md"
                containerClassName="flex-row items-center gap-2 mb-0"
                inputClassName="flex-1 text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm"
              />
            </View>
            <ApplyToPageButton field="brand_primaryColor" show={apply} onApply={onApplyFieldToPage} />
          </View>
          <Text className={labelClassName}>Accent Color (optional)</Text>
          <View className="flex-row items-center gap-2 mb-2">
            <View className="flex-1 min-w-0">
              <FluxHexColorField
                value={values.brand_accentColor}
                onChange={(hex) => onChange({ brand_accentColor: hex })}
                allowEmpty
                placeholder="#10b981"
                fallbackHex="#10b981"
                swatchSize="md"
                containerClassName="flex-row items-center gap-2 mb-0"
                inputClassName="flex-1 text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm"
              />
            </View>
            <ApplyToPageButton field="brand_accentColor" show={apply} onApply={onApplyFieldToPage} />
          </View>
          <View className="flex-row items-start gap-2 mb-2">
            <View className="flex-1 min-w-0">
              <Text className={labelClassName}>Font Family</Text>
              <FluxFontFamilyPicker
                value={values.brand_fontFamily}
                onChange={(fontFamily) => onChange({ brand_fontFamily: fontFamily })}
              />
            </View>
            <View className="pt-5">
              <ApplyToPageButton field="brand_fontFamily" show={apply} onApply={onApplyFieldToPage} />
            </View>
          </View>
          <View className="flex-row items-start justify-between gap-2 mb-1">
            <Text className={`${labelClassName} flex-1`}>Style preset</Text>
            <ApplyToPageButton field="brand_blockStylePreset" show={apply} onApply={onApplyFieldToPage} />
          </View>
          <View className="gap-2 mb-3">
            {FLUX_BLOCK_STYLE_PRESET_OPTIONS.map((option) => {
              const selected = values.brand_blockStylePreset === option.id;
              return (
                <Pressable
                  key={option.id}
                  className={`rounded-lg border px-3 py-2 ${
                    selected ? 'border-indigo-500 bg-indigo-500/15' : 'border-[#2A2A2A] bg-[#1A1A1A]'
                  }`}
                  onPress={() => onChange({ brand_blockStylePreset: option.id as FluxBlockStylePreset })}
                >
                  <Text className="text-white text-sm font-instrument-semibold">{option.label}</Text>
                  <Text className="text-gray-400 text-xs font-instrument mt-0.5">{option.description}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className={labelClassName}>Logo URL (optional)</Text>
          <View className="flex-row items-end gap-2 mb-2">
            <TextInput
              className={`${inputNoBottomMb} flex-1 min-w-0`}
              value={values.brand_logoUrl}
              onChangeText={(value) => onChange({ brand_logoUrl: value })}
              placeholder="https://acme.com/logo.png"
              placeholderTextColor="#555"
              autoCapitalize="none"
            />
            <ApplyToPageButton field="brand_logoUrl" show={apply} onApply={onApplyFieldToPage} />
          </View>
        </>
      ) : null}
    </View>
  );
}

export function fluxProspectRowToFieldValues(row: {
  name: string;
  company: string;
  role: string | null;
  url: string | null;
  industry: string | null;
  company_size: string | null;
  email_notes: string | null;
  brand_profile: import('@/lib/flux/types').BrandProfile | null;
}): FluxProspectDetailsFieldValues {
  const bp = row.brand_profile;
  return {
    name: row.name,
    company: row.company,
    role: row.role ?? '',
    url: row.url ?? '',
    industry: row.industry ?? '',
    company_size: row.company_size ?? '',
    email_notes: row.email_notes ?? '',
    brand_primaryColor: bp?.primaryColor ?? '#4f46e5',
    brand_accentColor: bp?.accentColor ?? '',
    brand_fontFamily: bp?.fontFamily ?? 'Inter',
    brand_logoUrl: bp?.logoUrl ?? '',
    brand_blockStylePreset: (bp?.blockStylePreset ?? 'classic') as FluxBlockStylePreset,
  };
}

export function fluxProspectFieldValuesToBrandProfile(
  v: FluxProspectDetailsFieldValues,
): import('@/lib/flux/types').BrandProfile {
  return {
    primaryColor: v.brand_primaryColor,
    accentColor: v.brand_accentColor.trim() ? v.brand_accentColor : undefined,
    fontFamily: v.brand_fontFamily.trim() ? v.brand_fontFamily : undefined,
    logoUrl: v.brand_logoUrl.trim() ? v.brand_logoUrl : undefined,
    blockStylePreset: v.brand_blockStylePreset,
  };
}
