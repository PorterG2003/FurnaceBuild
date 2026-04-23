import { useMemo, useEffect } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/Card';
import {
  ImportPreviewTable,
  ValidationSummaryCards,
  useImportWizard,
} from '@/components/foundry/imports';
import { classifyAllRows, summarizeClassification } from '@/lib/foundry/google-maps-import/validate';
import type { ColumnMap } from '@/lib/foundry/google-maps-import/validate';

export default function ImportPreviewPage() {
  const router = useRouter();
  const { parsed, columnMap } = useImportWizard();

  useEffect(() => {
    if (!parsed || !columnMap) {
      router.replace('/foundry/imports/new');
    }
  }, [parsed, columnMap, router]);

  const mapForValidate: ColumnMap | null = useMemo(() => {
    if (!columnMap) return null;
    return {
      nameRawHeader: columnMap.nameRawHeader,
      addressRawHeader: columnMap.addressRawHeader,
      websiteHeader: columnMap.websiteHeader,
      phoneHeader: columnMap.phoneHeader,
    };
  }, [columnMap]);

  const classified = useMemo(() => {
    if (!parsed || !mapForValidate) return [];
    return classifyAllRows(parsed.rows, mapForValidate);
  }, [parsed, mapForValidate]);

  const summary = useMemo(() => summarizeClassification(classified), [classified]);

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
            { label: 'Preview' },
          ]}
        />
      </View>
      <PageHeader
        title="Validate and preview"
        subtitle="Warnings can still import; error rows are skipped (or excluded if you turn off warning import later)"
      />

      <View className="mt-4 gap-4 w-full self-center" style={{ maxWidth: 1100 }}>
        <ValidationSummaryCards
          totalRows={summary.totalRows}
          validRows={summary.validRows}
          warningRows={summary.warningRows}
          errorRows={summary.errorRows}
        />

        <Card variant="card">
          <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Row preview</Text>
          <ImportPreviewTable rows={classified} />
        </Card>

        <View className="flex-row flex-wrap gap-2 justify-between">
          <Button variant="secondary" size="sm" onPress={() => router.back()}>
            Back
          </Button>
          <Button onPress={() => router.push('/foundry/imports/new/configure')}>Continue to configure</Button>
        </View>
      </View>
    </ScrollView>
  );
}
