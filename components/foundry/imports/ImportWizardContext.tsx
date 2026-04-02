import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { PostGoogleMapsImportResponse } from '@/lib/foundry/registry-types';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export interface ColumnMappingState {
  nameRawHeader: string;
  addressRawHeader: string;
  /** null = column not mapped (optional website) */
  websiteHeader: string | null;
}

interface ImportWizardContextValue {
  csvFileName: string | null;
  setCsvFileName: (v: string | null) => void;
  importName: string;
  setImportName: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  importWarnings: boolean;
  setImportWarnings: (v: boolean) => void;
  parsed: ParsedCsv | null;
  setParsed: (v: ParsedCsv | null) => void;
  columnMap: ColumnMappingState | null;
  setColumnMap: (v: ColumnMappingState | null) => void;
  /** Set after successful POST; used on results screen for error sample table. */
  lastImportResult: PostGoogleMapsImportResponse | null;
  setLastImportResult: (v: PostGoogleMapsImportResponse | null) => void;
  resetWizard: () => void;
}

const ImportWizardContext = createContext<ImportWizardContextValue | null>(null);

export function ImportWizardProvider({ children }: { children: React.ReactNode }) {
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [importName, setImportName] = useState('');
  const [notes, setNotes] = useState('');
  const [importWarnings, setImportWarnings] = useState(true);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMappingState | null>(null);
  const [lastImportResult, setLastImportResult] = useState<PostGoogleMapsImportResponse | null>(null);

  const resetWizard = useCallback(() => {
    setCsvFileName(null);
    setImportName('');
    setNotes('');
    setImportWarnings(true);
    setParsed(null);
    setColumnMap(null);
    setLastImportResult(null);
  }, []);

  const value = useMemo(
    () => ({
      csvFileName,
      setCsvFileName,
      importName,
      setImportName,
      notes,
      setNotes,
      importWarnings,
      setImportWarnings,
      parsed,
      setParsed,
      columnMap,
      setColumnMap,
      lastImportResult,
      setLastImportResult,
      resetWizard,
    }),
    [
      csvFileName,
      importName,
      notes,
      importWarnings,
      parsed,
      columnMap,
      lastImportResult,
      resetWizard,
    ],
  );

  return <ImportWizardContext.Provider value={value}>{children}</ImportWizardContext.Provider>;
}

export function useImportWizard(): ImportWizardContextValue {
  const ctx = useContext(ImportWizardContext);
  if (!ctx) {
    throw new Error('useImportWizard must be used within ImportWizardProvider');
  }
  return ctx;
}
