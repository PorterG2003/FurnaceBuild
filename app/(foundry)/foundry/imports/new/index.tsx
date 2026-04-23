import { useState, useCallback } from 'react';
import { View, ScrollView, Text, TextInput, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/Card';
import { CsvUploadDropzone, useImportWizard } from '@/components/foundry/imports';
import { parseGoogleMapsCsv } from '@/lib/foundry/google-maps-import/parseCsv';

export default function NewGoogleMapsImportPage() {
  const router = useRouter();
  const {
    csvFileName,
    setCsvFileName,
    importName,
    setImportName,
    setParsed,
    setColumnMap,
    resetWizard,
  } = useImportWizard();
  const [busy, setBusy] = useState(false);

  const onParsed = useCallback(
    (fileName: string, text: string) => {
      setBusy(true);
      try {
        const parsed = parseGoogleMapsCsv(text);
        if (!parsed.rows.length) {
          Alert.alert('No data', 'The CSV needs a header row and at least one data row.');
          return;
        }
        setCsvFileName(fileName);
        setParsed(parsed);
        setColumnMap({
          nameRawHeader: '',
          addressRawHeader: '',
          websiteHeader: null,
          phoneHeader: null,
        });
      } catch (e) {
        Alert.alert('Invalid CSV', e instanceof Error ? e.message : 'Could not parse file.');
      } finally {
        setBusy(false);
      }
    },
    [setColumnMap, setCsvFileName, setParsed],
  );

  const continueNext = () => {
    if (!importName.trim()) {
      Alert.alert('Import name', 'Enter a name for this import.');
      return;
    }
    if (!csvFileName) {
      Alert.alert('CSV required', 'Upload a CSV file first.');
      return;
    }
    router.push('/foundry/imports/new/map');
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
            { label: 'New import' },
          ]}
        />
      </View>
      <PageHeader
        title="New Import"
        subtitle="Google Maps CSV — business name, domain/website, phone, and address columns"
      />

      <View className="mt-4 gap-4 max-w-[720px] w-full self-center">
        <Card variant="card">
          <Text className="text-xs text-gray-500 uppercase tracking-wider mb-1">Source type</Text>
          <Text className="text-white font-instrument-medium text-base">Google Maps CSV</Text>
        </Card>

        <Card variant="card">
          <Text className="text-sm text-gray-300 font-instrument-medium mb-2">Import name *</Text>
          <TextInput
            value={importName}
            onChangeText={setImportName}
            placeholder="e.g. Phoenix contractors March 2025"
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2.5 text-white font-instrument text-base bg-[#121212]"
            editable={!busy}
          />
        </Card>

        <CsvUploadDropzone onParsed={onParsed} disabled={busy} />

        {csvFileName ? (
          <Card variant="card">
            <Text className="text-white font-instrument-medium text-sm">{csvFileName}</Text>
            <Text className="text-gray-500 font-instrument text-xs mt-1">
              Upload a CSV containing business name, domain, phone, and address columns.
            </Text>
          </Card>
        ) : null}

        <View className="flex-row flex-wrap gap-2 justify-between">
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              resetWizard();
              router.back();
            }}
          >
            Back
          </Button>
          <Button onPress={continueNext} disabled={busy}>
            Continue
          </Button>
        </View>

        {Platform.OS !== 'web' ? (
          <Text className="text-amber-600/90 font-instrument text-xs">CSV upload is supported on web.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
