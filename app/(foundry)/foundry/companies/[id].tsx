import { useCallback, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { fetchCompanyDetail } from '@/lib/foundry/registry-client';

export default function CompanyDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [json, setJson] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setError(null);
    try {
      const d = await fetchCompanyDetail(id);
      setJson(JSON.stringify(d, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setJson('');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!id || typeof id !== 'string') {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500">Invalid company.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb
        items={[
          { label: 'Foundry', href: '/foundry' },
          { label: 'Company' },
        ]}
      />
      <PageHeader title="Company detail" subtitle="Canonical company, locations, links, entity matches" />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <Text className="text-gray-500 font-instrument text-xs mb-2">API payload</Text>
      <Text className="text-gray-300 font-mono text-xs leading-5">{json || '…'}</Text>
    </ScrollView>
  );
}
