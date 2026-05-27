import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { debounce } from '@/lib/utils/debounce';
import { updateSavedLeadListColumnLayout } from '@/lib/supabase/services/leads/saved-lists';
import type { LeadsColumnDef } from './types';
import { assertColumnLayoutWritable, serializeColumnLayout } from './parseColumnLayout';

export type ColumnLayoutSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutoSaveColumnLayout(params: {
  accountId: string | undefined;
  listId: string | undefined;
  columns: LeadsColumnDef[];
  enabled?: boolean;
}) {
  const { accountId, listId, columns, enabled = true } = params;
  const [saveStatus, setSaveStatus] = useState<ColumnLayoutSaveStatus>('idle');
  const lastSavedRef = useRef<string | null>(null);
  const hasLoadedLayoutRef = useRef(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markLoaded = useCallback((layout: LeadsColumnDef[]) => {
    lastSavedRef.current = serializeColumnLayout(layout);
    hasLoadedLayoutRef.current = true;
  }, []);

  const resetLoaded = useCallback(() => {
    hasLoadedLayoutRef.current = false;
    lastSavedRef.current = null;
    setSaveStatus('idle');
  }, []);

  const persistLayout = useMemo(
    () =>
      debounce(async (nextColumns: LeadsColumnDef[]) => {
        if (!accountId || !listId || !hasLoadedLayoutRef.current) return;

        let normalized: LeadsColumnDef[];
        try {
          normalized = assertColumnLayoutWritable(nextColumns);
        } catch {
          setSaveStatus('error');
          if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
          return;
        }

        const serialized = serializeColumnLayout(normalized);
        if (serialized === lastSavedRef.current) return;

        setSaveStatus('saving');
        try {
          await updateSavedLeadListColumnLayout(accountId, listId, normalized);
          lastSavedRef.current = serialized;
          setSaveStatus('saved');
          if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
          savedTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
        } catch {
          setSaveStatus('error');
          if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
        }
      }, 1000),
    [accountId, listId],
  );

  useEffect(() => {
    if (!enabled || !hasLoadedLayoutRef.current) return;
    persistLayout(columns);
  }, [columns, enabled, persistLayout]);

  useEffect(
    () => () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    },
    [],
  );

  return { saveStatus, markLoaded, resetLoaded };
}
