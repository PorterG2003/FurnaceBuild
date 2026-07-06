import { View, Text, Pressable, Platform } from 'react-native';
import { ChevronRightIcon } from 'react-native-heroicons/outline';
import { Alert as UiAlert } from '@/components/ui/feedback';
import { SettingToggleRow } from '@/components/ui/forms/SettingToggleRow';
import { Toggle } from '@/components/ui/Toggle';
import { WorkbenchBulkReviewSkeleton } from '@/components/skeletons/WorkbenchBulkReviewSkeleton';
import {
  WorkbenchBulkMetricsGrid,
  WorkbenchBulkMetricRow,
} from '@/lib/leads/workbench/bulk/workbenchBulkModalMetrics';
import { CsvImportPreviewHero } from './CsvImportPreviewHero';
import type { CsvDedupeResult } from '@/lib/leads/csv-dedupe';

export type CsvImportDedupeStepProps = {
  isCompactLayout: boolean;
  filterInCampaignsEnabled: boolean;
  onFilterInCampaignsChange: (value: boolean) => void;
  filterBlockListEnabled: boolean;
  onFilterBlockListChange: (value: boolean) => void;
  selectedDedupeCampaignIds: string[];
  selectedCampaignNames: string[];
  onOpenCampaignPicker: () => void;
  dedupeResult: CsvDedupeResult | null;
  dedupePreviewLoading: boolean;
  dedupePreviewError: string | null;
};

function DedupePreviewPanel({
  dedupeResult,
  dedupePreviewLoading,
  selectedCampaignNames,
}: {
  dedupeResult: CsvDedupeResult | null;
  dedupePreviewLoading: boolean;
  selectedCampaignNames: string[];
}) {
  if (dedupePreviewLoading) {
    return <WorkbenchBulkReviewSkeleton metricCount={5} showHero />;
  }

  const stats = dedupeResult?.stats;
  const kept = stats?.kept ?? 0;
  const campaignHelp =
    selectedCampaignNames.length > 0
      ? `Selected campaigns: ${selectedCampaignNames.join(', ')}`
      : undefined;

  return (
    <View className="gap-3">
      <CsvImportPreviewHero readyCount={kept} />

      <WorkbenchBulkMetricsGrid>
        <WorkbenchBulkMetricRow label="Rows in file" value={stats?.totalInput ?? 0} />
        <WorkbenchBulkMetricRow label="Duplicate emails removed" value={stats?.removedWithinFile ?? 0} />
        <WorkbenchBulkMetricRow
          label="Already in campaigns removed"
          value={stats?.removedInCampaigns ?? 0}
          help={campaignHelp}
        />
        <WorkbenchBulkMetricRow label="Block list removed" value={stats?.removedBlocked ?? 0} />
        <WorkbenchBulkMetricRow label="Ready to import" value={kept} />
      </WorkbenchBulkMetricsGrid>
    </View>
  );
}

function DedupeFiltersPanel({
  filterInCampaignsEnabled,
  onFilterInCampaignsChange,
  filterBlockListEnabled,
  onFilterBlockListChange,
  selectedDedupeCampaignIds,
  selectedCampaignNames,
  onOpenCampaignPicker,
  dedupePreviewError,
}: Omit<CsvImportDedupeStepProps, 'isCompactLayout' | 'dedupeResult' | 'dedupePreviewLoading'>) {
  const campaignCount = selectedDedupeCampaignIds.length;
  const needsCampaignSelection = filterInCampaignsEnabled && campaignCount === 0;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#121212] px-4 py-3">
        <View className="flex-1">
          <Text className="text-white font-instrument-medium">Remove duplicate emails in file</Text>
          <Text className="text-gray-400 font-instrument text-sm mt-1">
            Keeps the first row for each email address.
          </Text>
        </View>
        <View className="px-2 py-1 rounded-md bg-white/10">
          <Text className="text-xs text-gray-300 font-instrument-medium">Always on</Text>
        </View>
      </View>

      <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4 gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-white font-instrument-medium">Remove leads already in campaigns</Text>
            <Text className="text-gray-400 font-instrument text-sm mt-1">
              Skip people who already exist in the campaigns you select.
            </Text>
          </View>
          <Toggle value={filterInCampaignsEnabled} onValueChange={onFilterInCampaignsChange} />
        </View>

        {filterInCampaignsEnabled ? (
          <View className="gap-2">
            <Pressable
              onPress={onOpenCampaignPicker}
              accessibilityRole="button"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: '#2A2A2A',
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 12,
                backgroundColor: '#181818',
                ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : {}),
              }}
            >
              <Text className="text-sm text-white font-instrument-medium">
                {campaignCount === 0
                  ? 'Choose campaigns…'
                  : `Edit campaigns (${campaignCount})`}
              </Text>
              <ChevronRightIcon size={18} color="#9CA3AF" />
            </Pressable>
            {needsCampaignSelection ? (
              <Text className="text-xs text-amber-400/90 font-instrument">
                Choose at least one campaign to continue.
              </Text>
            ) : selectedCampaignNames.length > 0 ? (
              <Text className="text-xs text-gray-400 font-instrument">{selectedCampaignNames.join(', ')}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <SettingToggleRow
        label="Remove leads on block list"
        description="Skip blocked emails and domains from your account block list."
        value={filterBlockListEnabled}
        onValueChange={onFilterBlockListChange}
      />

      {dedupePreviewError ? (
        <UiAlert
          variant="warning"
          message={`${dedupePreviewError} Block list and in-file dedupe still apply.`}
        />
      ) : null}
    </View>
  );
}

export function CsvImportDedupeStep(props: CsvImportDedupeStepProps) {
  const previewPanel = (
    <View className="gap-3 flex-1 min-w-0">
      <Text className="text-xs text-gray-400 font-instrument uppercase tracking-wide">Import preview</Text>
      <DedupePreviewPanel
        dedupeResult={props.dedupeResult}
        dedupePreviewLoading={props.dedupePreviewLoading}
        selectedCampaignNames={props.selectedCampaignNames}
      />
    </View>
  );

  const filtersPanel = (
    <View className="gap-3 flex-1 min-w-0">
      <Text className="text-xs text-gray-400 font-instrument uppercase tracking-wide">Filters</Text>
      <DedupeFiltersPanel
        filterInCampaignsEnabled={props.filterInCampaignsEnabled}
        onFilterInCampaignsChange={props.onFilterInCampaignsChange}
        filterBlockListEnabled={props.filterBlockListEnabled}
        onFilterBlockListChange={props.onFilterBlockListChange}
        selectedDedupeCampaignIds={props.selectedDedupeCampaignIds}
        selectedCampaignNames={props.selectedCampaignNames}
        onOpenCampaignPicker={props.onOpenCampaignPicker}
        dedupePreviewError={props.dedupePreviewError}
      />
    </View>
  );

  if (props.isCompactLayout) {
    return (
      <View className="gap-6">
        {previewPanel}
        {filtersPanel}
      </View>
    );
  }

  return (
    <View className="flex-row gap-6">
      <View style={{ flex: 0.55, minWidth: 0 }}>{filtersPanel}</View>
      <View style={{ flex: 0.45, minWidth: 0 }}>{previewPanel}</View>
    </View>
  );
}

export default CsvImportDedupeStep;
