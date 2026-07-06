import { View, Text } from 'react-native';
import { Alert as UiAlert } from '@/components/ui/feedback';
import {
  WorkbenchBulkMetricsGrid,
  WorkbenchBulkMetricRow,
} from '@/lib/leads/workbench/bulk/workbenchBulkModalMetrics';
import { CsvImportPreviewHero } from './CsvImportPreviewHero';

function CsvImportMappingRow({ csvColumn, leadField }: { csvColumn: string; leadField: string }) {
  return (
    <View className="flex-row items-center gap-3 border border-[#2A2A2A] rounded-xl px-3 py-3 bg-[#181818]">
      <View className="flex-1 min-w-0">
        <Text className="text-[10px] text-gray-500 font-instrument uppercase tracking-wide">CSV column</Text>
        <Text className="text-white font-instrument-semibold text-sm mt-0.5" numberOfLines={2}>
          {csvColumn}
        </Text>
      </View>
      <Text className="text-gray-500 font-instrument text-sm shrink-0">→</Text>
      <View className="flex-1 min-w-0">
        <Text className="text-[10px] text-gray-500 font-instrument uppercase tracking-wide">Lead field</Text>
        <Text className="text-gray-300 font-instrument text-sm mt-0.5" numberOfLines={2}>
          {leadField}
        </Text>
      </View>
    </View>
  );
}

export type CsvImportReviewSummary = {
  totalRows: number;
  readyRows: number;
  dedupeRemoved: number;
  mappedFields: Array<{ label: string; column: string }>;
  unmappedColumns: string[];
};

export type CsvImportReviewStepProps = {
  fileName: string | null;
  summary: CsvImportReviewSummary | null;
};

function ImportSummaryPanel({
  summary,
  fileName,
}: {
  summary: CsvImportReviewSummary;
  fileName: string | null;
}) {
  const removedHint =
    summary.dedupeRemoved > 0
      ? `${summary.dedupeRemoved.toLocaleString()} removed by filters from ${summary.totalRows.toLocaleString()} rows in file`
      : undefined;

  return (
    <View className="gap-3">
      <CsvImportPreviewHero
        readyCount={summary.readyRows}
        subtitle={fileName ? `From ${fileName}` : undefined}
        removedHint={removedHint}
      />

      <WorkbenchBulkMetricsGrid>
        <WorkbenchBulkMetricRow label="Rows in file" value={summary.totalRows} />
        {summary.dedupeRemoved > 0 ? (
          <WorkbenchBulkMetricRow label="Removed by filters" value={summary.dedupeRemoved} />
        ) : null}
        <WorkbenchBulkMetricRow label="Ready to import" value={summary.readyRows} />
      </WorkbenchBulkMetricsGrid>
    </View>
  );
}

function FieldMappingPanel({ summary }: { summary: CsvImportReviewSummary }) {
  const hasMappings = summary.mappedFields.length > 0;

  return (
    <View className="gap-3">
      <Text className="text-xs text-gray-400 font-instrument uppercase tracking-wide">Field mapping</Text>

      {hasMappings ? (
        <WorkbenchBulkMetricsGrid>
          {summary.mappedFields.map((row) => (
            <CsvImportMappingRow
              key={`${row.label}-${row.column}`}
              csvColumn={row.column}
              leadField={row.label}
            />
          ))}
        </WorkbenchBulkMetricsGrid>
      ) : (
        <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] px-4 py-3">
          <Text className="text-sm text-gray-400 font-instrument">No fields mapped.</Text>
        </View>
      )}

      {summary.unmappedColumns.length > 0 ? (
        <UiAlert
          variant="warning"
          message={`${summary.unmappedColumns.length} CSV column${summary.unmappedColumns.length === 1 ? '' : 's'} will not be imported: ${summary.unmappedColumns.join(', ')}`}
        />
      ) : null}
    </View>
  );
}

export function CsvImportReviewStep({ fileName, summary }: CsvImportReviewStepProps) {
  if (!summary) {
    return (
      <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] px-4 py-3">
        <Text className="text-sm text-gray-400 font-instrument">
          Complete the previous steps to review your import.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-6">
      <ImportSummaryPanel summary={summary} fileName={fileName} />
      <FieldMappingPanel summary={summary} />
    </View>
  );
}

export default CsvImportReviewStep;
