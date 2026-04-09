import { useEffect, useRef } from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { ImportProgressPanel, useImportWizard } from '@/components/foundry/imports';
import { postGoogleMapsImport } from '@/lib/foundry/registry-client';

export default function ImportProgressPage() {
  const router = useRouter();
  const {
    parsed,
    columnMap,
    importName,
    notes,
    importWarnings,
    costPerRowInput,
    setLastImportResult,
  } = useImportWizard();
  const started = useRef(false);

  useEffect(() => {
    const p = parsed;
    const cm = columnMap;
    const name = importName.trim();
    if (!p || !cm || !name) {
      router.replace('/foundry/imports/new');
      return;
    }

    const rowsSnapshot = p.rows;
    const columnSnapshot = {
      nameRawHeader: cm.nameRawHeader,
      addressRawHeader: cm.addressRawHeader,
      websiteHeader: cm.websiteHeader,
    };
    const notesSnapshot = notes.trim() || undefined;
    const warnSnapshot = importWarnings;
    const costRaw = costPerRowInput.trim();
    const parsedCost = costRaw === '' ? NaN : Number.parseInt(costRaw, 10);
    const costPayload = Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : undefined;

    if (started.current) return;
    started.current = true;

    let cancelled = false;

    async function run() {
      try {
        const res = await postGoogleMapsImport({
          importName: name,
          notes: notesSnapshot,
          sourceName: 'google_maps',
          importWarnings: warnSnapshot,
          columnMap: columnSnapshot,
          rows: rowsSnapshot,
          ...(costPayload != null ? { costPerRowCents: costPayload } : {}),
        });
        if (cancelled) return;
        setLastImportResult(res);
        router.replace(`/foundry/imports/${res.runId}/results`);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Import failed';
        Alert.alert('Import failed', msg, [
          { text: 'OK', onPress: () => router.replace('/foundry/imports/new/configure') },
        ]);
      }
    }

    void run();
    return () => {
      cancelled = true;
      started.current = false;
    };
  }, [
    parsed,
    columnMap,
    importName,
    notes,
    importWarnings,
    costPerRowInput,
    router,
    setLastImportResult,
  ]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="mb-4">
        <Breadcrumb
          items={[
            { label: 'Foundry', href: '/foundry' },
            { label: 'Imports', href: '/foundry/imports' },
            { label: 'New import', href: '/foundry/imports/new' },
            { label: 'Importing…' },
          ]}
        />
      </View>
      <PageHeader title="Import in progress" subtitle="Creating ingestion run and source records" />
      <ImportProgressPanel busy />
    </ScrollView>
  );
}
