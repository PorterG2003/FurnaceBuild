import { useEffect, useState } from 'react';
import { View, ScrollView, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { useImportWizard } from '@/components/foundry/imports';
import {
  GOOGLE_MAPS_PARSER_VERSION,
  FOUNDRY_IMPORT_INGEST_VERSION,
} from '@/lib/foundry/google-maps-import/constants';
import { fetchCurrentCostRate } from '@/lib/foundry/registry-client';

export default function ImportConfigurePage() {
  const router = useRouter();
  const {
    parsed,
    columnMap,
    importName,
    setImportName,
    notes,
    setNotes,
    importWarnings,
    setImportWarnings,
    costPerRowInput,
    setCostPerRowInput,
  } = useImportWizard();

  const [costDefaultLoaded, setCostDefaultLoaded] = useState(false);

  useEffect(() => {
    if (!parsed || !columnMap) {
      router.replace('/foundry/imports/new');
    }
  }, [parsed, columnMap, router]);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentCostRate({
      cost_kind: 'acquisition',
      provider: 'google_maps',
      product: 'import_row',
    })
      .then((res) => {
        if (cancelled) return;
        const cents = res.rate?.unitPriceCents;
        if (cents != null && Number.isFinite(cents)) {
          setCostPerRowInput((prev) => (prev.trim() === '' ? String(Math.trunc(cents)) : prev));
        }
        setCostDefaultLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setCostDefaultLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setCostPerRowInput]);

  if (!parsed || !columnMap) {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500 font-instrument">Loading…</Text>
      </View>
    );
  }

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
            { label: 'Configure' },
          ]}
        />
      </View>
      <PageHeader title="Configure import" subtitle="Finalize metadata before running" />

      <View className="mt-4 gap-4 max-w-[720px] w-full self-center">
        <Card variant="card">
          <Text className="text-sm text-gray-300 font-instrument-medium mb-2">Import name *</Text>
          <TextInput
            value={importName}
            onChangeText={setImportName}
            placeholder="Import name"
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2.5 text-white font-instrument text-base bg-[#121212]"
          />
        </Card>

        <Card variant="card">
          <Text className="text-sm text-gray-300 font-instrument-medium mb-2">Source name</Text>
          <Text className="text-white font-instrument text-base">google_maps</Text>
          <Text className="text-xs text-gray-500 mt-2">source_type: google_maps (fixed for v1)</Text>
        </Card>

        <Card variant="card">
          <Text className="text-sm text-gray-300 font-instrument-medium mb-2">Cost per imported row (cents)</Text>
          <TextInput
            value={costPerRowInput}
            onChangeText={setCostPerRowInput}
            placeholder="e.g. 2"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2.5 text-white font-instrument text-base bg-[#121212]"
          />
          <Text className="text-xs text-gray-500 mt-2">
            {costDefaultLoaded
              ? 'Defaults from Foundry cost settings; change if this list used a different acquisition price.'
              : 'Loading default from cost rate cards…'}
          </Text>
        </Card>

        <Card variant="card">
          <Text className="text-sm text-gray-300 font-instrument-medium mb-2">Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Operator notes"
            placeholderTextColor="#6b7280"
            multiline
            className="border border-[#3A3A3A] rounded-lg px-3 py-2.5 text-white font-instrument text-base bg-[#121212] min-h-[88px]"
            textAlignVertical="top"
          />
        </Card>

        <Card variant="card">
          <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">System</Text>
          <Text className="text-gray-400 font-instrument text-sm">Parser version: {GOOGLE_MAPS_PARSER_VERSION}</Text>
          <Text className="text-gray-400 font-instrument text-sm mt-1">
            Ingest version: {FOUNDRY_IMPORT_INGEST_VERSION}
          </Text>
        </Card>

        <Card variant="card">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 pr-2">
              <Text className="text-white text-sm font-instrument-medium">Import rows with warnings</Text>
              <Text className="text-xs text-gray-400 mt-1">
                When off, only rows with no warnings are inserted. Error rows are always skipped.
              </Text>
            </View>
            <Toggle value={importWarnings} onValueChange={setImportWarnings} />
          </View>
        </Card>

        <View className="flex-row flex-wrap gap-2 justify-between">
          <Button variant="secondary" size="sm" onPress={() => router.back()}>
            Back
          </Button>
          <Button
            onPress={() => {
              if (!importName.trim()) return;
              router.push('/foundry/imports/new/progress');
            }}
            disabled={!importName.trim()}
          >
            Start import
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
