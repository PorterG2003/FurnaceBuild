import { useState } from 'react';
import { View, ScrollView, Text, Pressable, TextInput } from 'react-native';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import {
  fetchRegistryCompanies,
  postStateMatchingBatch,
  postStateMatchingPreflight,
} from '@/lib/foundry/registry-client';

export default function StateMatchingPage() {
  const [companyIdsText, setCompanyIdsText] = useState('');
  const [preflight, setPreflight] = useState<string>('');
  const [batchResult, setBatchResult] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function parseIds(): string[] {
    return companyIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'State matching' }]} />
      <PageHeader
        title="State matching (mock)"
        subtitle="Preflight + batch uses mock state runner — no real registry connectors."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <Pressable
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const { companies } = await fetchRegistryCompanies({ limit: 30 });
            setCompanyIdsText(companies.map((c) => c.id).join('\n'));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
          } finally {
            setBusy(false);
          }
        }}
        className="mb-3 px-3 py-2 rounded-lg border border-[#3A3A3A] self-start"
      >
        <Text className="text-gray-200 font-instrument text-sm">Load sample company IDs</Text>
      </Pressable>

      <Text className="text-gray-500 font-instrument text-xs mb-1">Company UUIDs (whitespace or comma separated)</Text>
      <TextInput
        multiline
        value={companyIdsText}
        onChangeText={setCompanyIdsText}
        placeholder="uuid per line"
        placeholderTextColor="#666"
        className="text-gray-200 font-mono text-xs p-3 rounded border border-[#3A3A3A] bg-[#121212] min-h-[120px] mb-3"
      />

      <View className="flex-row flex-wrap gap-2 mb-4">
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            setPreflight('');
            try {
              const r = await postStateMatchingPreflight(parseIds());
              setPreflight(JSON.stringify(r, null, 2));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Preflight failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A]"
        >
          <Text className="text-gray-200 font-instrument text-sm">Preflight</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            setBatchResult('');
            try {
              const r = await postStateMatchingBatch(parseIds().slice(0, 50));
              setBatchResult(JSON.stringify(r, null, 2));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Batch failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-brand-orange/50 bg-[rgba(243,68,13,0.08)]"
        >
          <Text className="text-white font-instrument text-sm">Run batch (mock)</Text>
        </Pressable>
      </View>

      {preflight ? (
        <>
          <Text className="text-gray-500 font-instrument text-xs mb-1">Preflight</Text>
          <Text className="text-gray-300 font-mono text-xs leading-5 mb-4">{preflight}</Text>
        </>
      ) : null}
      {batchResult ? (
        <>
          <Text className="text-gray-500 font-instrument text-xs mb-1">Batch result</Text>
          <Text className="text-gray-300 font-mono text-xs leading-5">{batchResult}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}
