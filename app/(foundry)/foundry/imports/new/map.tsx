import { useMemo, useEffect } from 'react';
import { View, ScrollView, Alert, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ColumnMappingForm, useImportWizard } from '@/components/foundry/imports';

export default function ImportColumnMappingPage() {
  const router = useRouter();
  const { parsed, columnMap, setColumnMap } = useImportWizard();

  useEffect(() => {
    if (!parsed || !columnMap) {
      router.replace('/foundry/imports/new');
    }
  }, [parsed, columnMap, router]);

  const sampleRows = useMemo(() => parsed?.rows.slice(0, 3) ?? [], [parsed]);

  if (!parsed || !columnMap) {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500 font-instrument">Loading…</Text>
      </View>
    );
  }

  const canContinue =
    columnMap.nameRawHeader &&
    columnMap.addressRawHeader &&
    parsed.headers.includes(columnMap.nameRawHeader) &&
    parsed.headers.includes(columnMap.addressRawHeader) &&
    (!columnMap.websiteHeader || parsed.headers.includes(columnMap.websiteHeader));

  const onContinue = () => {
    if (!canContinue) {
      Alert.alert('Mapping', 'Map business name and full address to valid columns.');
      return;
    }
    router.push('/foundry/imports/new/preview');
  };

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
            { label: 'Map columns' },
          ]}
        />
      </View>
      <PageHeader title="Map columns" subtitle="Match CSV headers to Foundry fields" />

      <View className="mt-4 gap-4 max-w-[720px] w-full self-center">
        <ColumnMappingForm
          headers={parsed.headers}
          sampleRows={sampleRows}
          value={columnMap}
          onChange={setColumnMap}
        />

        <View className="flex-row flex-wrap gap-2 justify-between">
          <Button variant="secondary" size="sm" onPress={() => router.back()}>
            Back
          </Button>
          <Button onPress={onContinue} disabled={!canContinue}>
            Continue
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
