import { isValidCustomFieldKey, normalizeCustomFieldKey } from './csv-dedupe';

export type LeadSourceFieldConfigInput = {
  existingCustomFieldKeys?: string[];
  existingMappedStandardFieldKeys?: string[];
  newCustomFieldColumns: string[];
  fieldMappings: Record<string, string>;
  hasActiveCsvMapping: boolean;
};

export type LeadSourceFieldConfig = {
  customFieldKeys: string[];
  mappedStandardFieldKeys?: string[];
};

export function buildLeadSourceFieldConfig({
  existingCustomFieldKeys,
  existingMappedStandardFieldKeys,
  newCustomFieldColumns,
  fieldMappings,
  hasActiveCsvMapping,
}: LeadSourceFieldConfigInput): LeadSourceFieldConfig {
  const customFieldKeys = Array.from(
    new Set(
      [...(existingCustomFieldKeys ?? []), ...newCustomFieldColumns]
        .map((key) => normalizeCustomFieldKey(key))
        .filter((key) => key.length > 0 && isValidCustomFieldKey(key)),
    ),
  );

  const mappedStandardFieldKeys = hasActiveCsvMapping
    ? Object.entries(fieldMappings)
        .filter(([, column]) => column?.trim())
        .map(([key]) => key)
    : existingMappedStandardFieldKeys;

  return {
    customFieldKeys,
    mappedStandardFieldKeys,
  };
}
