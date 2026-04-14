import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { CsvBuilderColumnRow, CsvBuilderToolType } from '@/lib/foundry/registry-types';
import { getCsvBuilderDefaultSelectedOutputKeys, getCsvBuilderToolManifest } from '@/lib/foundry/csv-builder';

export type CsvBuilderWizardStep = 0 | 1 | 2 | 3;

type CsvBuilderAddColumnWizardContextValue = {
  step: CsvBuilderWizardStep;
  setStep: (step: CsvBuilderWizardStep) => void;
  toolType: CsvBuilderToolType | null;
  label: string;
  setLabel: (value: string) => void;
  inputMapping: Record<string, string>;
  setInputMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedOutputs: string[];
  setSelectedOutputs: React.Dispatch<React.SetStateAction<string[]>>;
  includeRawJson: boolean;
  setIncludeRawJson: React.Dispatch<React.SetStateAction<boolean>>;
  resetWizard: () => void;
  selectTool: (toolType: CsvBuilderToolType) => void;
};

const CsvBuilderAddColumnWizardContext = createContext<CsvBuilderAddColumnWizardContextValue | null>(null);

function firstMatching(
  columns: CsvBuilderColumnRow[],
  pattern: RegExp,
  opts?: { toolType?: CsvBuilderToolType; outputKey?: string; kind?: CsvBuilderColumnRow['kind'] },
): string {
  const match = columns.find((column) => {
    if (opts?.kind && column.kind !== opts.kind) return false;
    if (opts?.toolType && column.tool_type !== opts.toolType) return false;
    if (opts?.outputKey && column.tool_output_key !== opts.outputKey) return false;
    return pattern.test(column.label);
  });
  return match?.id ?? '';
}

function suggestInputMapping(toolType: CsvBuilderToolType, columns: CsvBuilderColumnRow[]): Record<string, string> {
  const ordered = [...columns].sort((a, b) => a.position - b.position);
  const mapping: Record<string, string> = {};
  const website =
    firstMatching(ordered, /website|url|domain|homepage|site/i, { kind: 'source' }) ||
    firstMatching(ordered, /website|url|domain|homepage|site/i);
  const companyName = firstMatching(ordered, /company|name/i, { kind: 'source' }) || firstMatching(ordered, /company|name/i);
  const phone = firstMatching(ordered, /phone/i, { kind: 'source' }) || firstMatching(ordered, /phone/i);
  const city = firstMatching(ordered, /city/i, { kind: 'source' }) || firstMatching(ordered, /city/i);
  const state = firstMatching(ordered, /state|region/i, { kind: 'source' }) || firstMatching(ordered, /state|region/i);
  if (website) mapping.website = website;
  if (companyName) mapping.company_name = companyName;
  if (phone) mapping.phone = phone;
  if (city) mapping.city = city;
  if (state) mapping.state = state;
  if (toolType === 'google_ads_verification') {
    const finalUrl = ordered.find(
      (column) => column.tool_type === 'website_verification' && column.tool_output_key === 'final_url',
    );
    if (finalUrl?.id) mapping.website = finalUrl.id;
  }
  return mapping;
}

export function CsvBuilderAddColumnWizardProvider({
  columns,
  children,
}: {
  columns: CsvBuilderColumnRow[];
  children: React.ReactNode;
}) {
  const [step, setStep] = useState<CsvBuilderWizardStep>(0);
  const [toolType, setToolType] = useState<CsvBuilderToolType | null>(null);
  const [label, setLabel] = useState('');
  const [inputMapping, setInputMapping] = useState<Record<string, string>>({});
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([]);
  const [includeRawJson, setIncludeRawJson] = useState(false);

  const resetWizard = useCallback(() => {
    setStep(0);
    setToolType(null);
    setLabel('');
    setInputMapping({});
    setSelectedOutputs([]);
    setIncludeRawJson(false);
  }, []);

  const selectTool = useCallback(
    (nextToolType: CsvBuilderToolType) => {
      setToolType(nextToolType);
      setLabel(getCsvBuilderToolManifest(nextToolType).label);
      setInputMapping(suggestInputMapping(nextToolType, columns));
      setSelectedOutputs(getCsvBuilderDefaultSelectedOutputKeys(nextToolType));
      setIncludeRawJson(false);
      setStep(1);
    },
    [columns],
  );

  const value = useMemo(
    () => ({
      step,
      setStep,
      toolType,
      label,
      setLabel,
      inputMapping,
      setInputMapping,
      selectedOutputs,
      setSelectedOutputs,
      includeRawJson,
      setIncludeRawJson,
      resetWizard,
      selectTool,
    }),
    [includeRawJson, inputMapping, label, resetWizard, selectTool, selectedOutputs, step, toolType],
  );

  return (
    <CsvBuilderAddColumnWizardContext.Provider value={value}>{children}</CsvBuilderAddColumnWizardContext.Provider>
  );
}

export function useCsvBuilderAddColumnWizard(): CsvBuilderAddColumnWizardContextValue {
  const ctx = useContext(CsvBuilderAddColumnWizardContext);
  if (!ctx) throw new Error('useCsvBuilderAddColumnWizard must be used within CsvBuilderAddColumnWizardProvider');
  return ctx;
}
