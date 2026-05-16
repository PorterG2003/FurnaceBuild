import { useMemo, useCallback } from 'react';
import { View, Text } from 'react-native';
import { DateInput } from '@/components/ui/DateInput';
import { Select } from '@/components/ui/forms/Select';
import { SearchAndSelectMulti } from '@/components/ui/forms/SearchAndSelectMulti';
import type { CampaignListSummary } from '@/lib/supabase/services/campaigns';
import {
  ACCOUNT_METRICS_DATE_PRESET_IDS,
  type AccountMetricsDatePresetId,
  findMatchingPreset,
  presetRange,
} from '@/lib/metrics/accountMetricsDateRange';

const PRESET_SELECT_LABELS: Record<AccountMetricsDatePresetId, string> = {
  last_7: 'Last 7 days',
  last_30: 'Last 30 days',
  last_90: 'Last 90 days',
  ytd: 'Year to date',
  last_365: 'Last 365 days',
};

type PresetSelectRow = { id: AccountMetricsDatePresetId; label: string };

const PRESET_SELECT_ITEMS: PresetSelectRow[] = ACCOUNT_METRICS_DATE_PRESET_IDS.map((id) => ({
  id,
  label: PRESET_SELECT_LABELS[id],
}));

function metricsCampaignGetId(c: CampaignListSummary): string {
  return c.id;
}

function metricsCampaignGetLabel(c: CampaignListSummary): string {
  return c.name;
}

function metricsCampaignEmptyMessage(hasSearch: boolean): string {
  return hasSearch ? 'No campaigns match' : 'No Furnace campaigns';
}

function metricsPresetGetId(r: PresetSelectRow): string {
  return r.id;
}

function metricsPresetGetLabel(r: PresetSelectRow): { primary: string } {
  return { primary: r.label };
}

export type AccountMetricsToolbarVariant = 'header' | 'sheet';

export interface AccountMetricsToolbarProps {
  /**
   * `header` — compact inline controls for the page header (desktop).
   * `sheet` — stacked, full-width controls for the mobile filters bottom sheet (44pt-friendly triggers).
   */
  variant?: AccountMetricsToolbarVariant;
  startDate: string;
  endDate: string;
  onChangeRange: (start: string, end: string) => void;
  campaignIds: string[];
  onChangeCampaignIds: (ids: string[]) => void;
  campaignOptions: CampaignListSummary[];
  loading?: boolean;
  disabled?: boolean;
  campaignsLoading?: boolean;
}

export function AccountMetricsToolbar({
  variant = 'header',
  startDate,
  endDate,
  onChangeRange,
  campaignIds,
  onChangeCampaignIds,
  campaignOptions,
  loading = false,
  disabled = false,
  campaignsLoading = false,
}: AccountMetricsToolbarProps) {
  const activePreset = useMemo(
    () => findMatchingPreset(startDate, endDate),
    [startDate, endDate],
  );

  const busy = disabled || loading;
  const campaignBusy = busy || campaignsLoading;

  const presetSelectValue = useMemo(
    () => (activePreset === 'custom' ? null : activePreset),
    [activePreset],
  );

  const handlePresetSelectChange = useCallback(
    (_id: string, item: PresetSelectRow | null) => {
      if (!item) return;
      const r = presetRange(item.id, new Date());
      onChangeRange(r.start, r.end);
    },
    [onChangeRange],
  );

  const handleStartDateChange = useCallback(
    (v: string) => {
      onChangeRange(v, endDate);
    },
    [onChangeRange, endDate],
  );

  const handleEndDateChange = useCallback(
    (v: string) => {
      onChangeRange(startDate, v);
    },
    [onChangeRange, startDate],
  );

  if (variant === 'sheet') {
    return (
      <View className="gap-6 w-full">
        <View
          style={campaignBusy ? { opacity: 0.45 } : undefined}
          pointerEvents={campaignBusy ? 'none' : 'auto'}
        >
          <SearchAndSelectMulti<CampaignListSummary>
            items={campaignOptions}
            getItemId={metricsCampaignGetId}
            getItemLabel={metricsCampaignGetLabel}
            value={campaignIds}
            onChange={onChangeCampaignIds}
            searchPlaceholder="Search campaigns…"
            placeholder="All campaigns"
            noMargin
            listMaxHeight={320}
            emptyMessage={metricsCampaignEmptyMessage}
          />
        </View>

        <View>
          <Select<PresetSelectRow>
            searchable={false}
            items={PRESET_SELECT_ITEMS}
            getItemId={metricsPresetGetId}
            getItemLabel={metricsPresetGetLabel}
            value={presetSelectValue}
            onChange={handlePresetSelectChange}
            placeholder="Custom range"
            noMargin
            listMaxHeight={320}
          />
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1 min-w-0" accessibilityLabel="Start date">
            <DateInput
              value={startDate}
              onChange={handleStartDateChange}
              max={endDate}
              disabled={busy}
              placeholder="Start date"
              triggerSize="comfortable"
            />
          </View>
          <View className="flex-1 min-w-0" accessibilityLabel="End date">
            <DateInput
              value={endDate}
              onChange={handleEndDateChange}
              min={startDate}
              disabled={busy}
              placeholder="End date"
              triggerSize="comfortable"
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
      <View
        className="min-w-[160px] w-[220px] max-w-[280px] shrink-0"
        style={campaignBusy ? { opacity: 0.45 } : undefined}
        pointerEvents={campaignBusy ? 'none' : 'auto'}
      >
        <SearchAndSelectMulti<CampaignListSummary>
          items={campaignOptions}
          getItemId={metricsCampaignGetId}
          getItemLabel={metricsCampaignGetLabel}
          value={campaignIds}
          onChange={onChangeCampaignIds}
          searchPlaceholder="Search campaigns…"
          placeholder="All campaigns"
          size="compact"
          panelSize="compact"
          emptyMessage={metricsCampaignEmptyMessage}
          noMargin
        />
      </View>

      <View className="min-w-[150px] max-w-[220px]">
        <Select<PresetSelectRow>
          searchable={false}
          items={PRESET_SELECT_ITEMS}
          getItemId={metricsPresetGetId}
          getItemLabel={metricsPresetGetLabel}
          value={presetSelectValue}
          onChange={handlePresetSelectChange}
          placeholder="Custom range"
          size="compact"
          panelSize="compact"
          noMargin
          listMaxHeight={280}
        />
      </View>

      <DateInput
        value={startDate}
        onChange={handleStartDateChange}
        max={endDate}
        disabled={busy}
        placeholder="From"
      />
      <DateInput
        value={endDate}
        onChange={handleEndDateChange}
        min={startDate}
        disabled={busy}
        placeholder="To"
      />
    </View>
  );
}
