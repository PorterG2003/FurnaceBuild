import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View, Pressable, Platform } from 'react-native';
import { ChevronDownIcon, ChevronRightIcon } from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { SearchAndSelectMulti } from '@/components/ui/forms/SearchAndSelectMulti';
import { Select } from '@/components/ui/forms/Select';
import { Tabs, type Tab } from '@/components/ui/tabs';
import type {
  ExportFiltersState,
  ExportGoogleAdsResultFilter,
  ExportPresentationMode,
  ExportReadyFilter,
  ExportTriFilter,
} from '@/components/foundry/export/exportFilterTypes';

const READY_TABS: Tab[] = [
  { id: 'ready', label: 'Export-ready' },
  { id: 'all', label: 'All rows' },
  { id: 'blocked', label: 'Not ready' },
];

const GOOGLE_ADS_TABS: Tab[] = [
  { id: 'any', label: 'Any' },
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'unknown', label: 'Unknown' },
];

const REGISTRY_STATE_OPTIONS = [
  { id: 'UT', label: 'Utah' },
  { id: 'FL', label: 'Florida' },
  { id: 'IA', label: 'Iowa' },
];

const TRI_FILTER_OPTIONS = [
  { id: 'any', label: 'Any' },
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

function FilterSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View
      className="border-b border-[#252525] pb-2"
      style={{
        alignSelf: 'stretch',
        ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
      }}
    >
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between py-1.5"
        style={{
          minWidth: 0,
          ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
        }}
      >
        <Text selectable={false} className="text-gray-300 font-instrument-semibold text-xs uppercase tracking-wider">
          {title}
        </Text>
        {open ? <ChevronDownIcon size={14} color="#9ca3af" /> : <ChevronRightIcon size={14} color="#9ca3af" />}
      </Pressable>
      {open ? (
        <View
          className="gap-2 pt-1"
          style={{
            alignSelf: 'stretch',
            ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View
      className="gap-1"
      style={{
        alignSelf: 'stretch',
        ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
      }}
    >
      <Text selectable={false} className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider">
        {label}
      </Text>
      {children}
    </View>
  );
}

function TriSelect({
  value,
  onChange,
  placeholder,
}: {
  value: ExportTriFilter;
  onChange: (next: ExportTriFilter) => void;
  placeholder: string;
}) {
  return (
    <Select
      items={TRI_FILTER_OPTIONS}
      getItemId={(item) => item.id}
      getItemLabel={(item) => ({ primary: item.label })}
      value={value}
      onChange={(id) => onChange(id as ExportTriFilter)}
      placeholder={placeholder}
      searchable={false}
      size="compact"
      panelSize="compact"
      noMargin
    />
  );
}

function GoogleAdsResultSelect({
  value,
  onChange,
}: {
  value: ExportGoogleAdsResultFilter;
  onChange: (next: ExportGoogleAdsResultFilter) => void;
}) {
  return (
    <Select
      items={GOOGLE_ADS_TABS}
      getItemId={(item) => item.id}
      getItemLabel={(item) => ({ primary: item.label })}
      value={value}
      onChange={(id) => onChange(id as ExportGoogleAdsResultFilter)}
      placeholder="Any"
      searchable={false}
      size="compact"
      panelSize="compact"
      noMargin
    />
  );
}

function Input({
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'none',
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#6b7280"
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      className="border border-[#333333] rounded-md px-2.5 py-1.5 text-white font-instrument text-xs bg-[#161616]"
      style={{
        ...(Platform.OS === 'web' ? { userSelect: 'text' as const } : {}),
      }}
    />
  );
}

export function ExportFiltersPanel({
  mode,
  filters,
  onChange,
  onApply,
  onClear,
  showActions = true,
}: {
  mode: ExportPresentationMode;
  filters: ExportFiltersState;
  onChange: (next: ExportFiltersState) => void;
  onApply?: () => void;
  onClear?: () => void;
  showActions?: boolean;
}) {
  const patch = (partial: Partial<ExportFiltersState>) => onChange({ ...filters, ...partial });
  const visibleSections = useMemo(
    () => ['Company', 'Geography', ...(mode === 'contact' ? ['Owner'] : []), 'Enrichments', 'Advanced'],
    [mode],
  );
  const [openSections, setOpenSections] = useState<string[]>([]);

  useEffect(() => {
    setOpenSections((current) => current.filter((section) => visibleSections.includes(section)));
  }, [visibleSections]);

  const toggleSection = (section: string) => {
    setOpenSections((current) =>
      current.includes(section) ? current.filter((value) => value !== section) : [...current, section],
    );
  };

  return (
    <View
      className="gap-3"
      style={{
        alignSelf: 'stretch',
        ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
      }}
    >
      <FilterSection title="Company" open={openSections.includes('Company')} onToggle={() => toggleSection('Company')}>
        <FilterField label="Name includes">
          <Input
            value={filters.companyNameQuery}
            onChangeText={(value) => patch({ companyNameQuery: value })}
            placeholder="e.g. Furnace"
            autoCapitalize="words"
          />
        </FilterField>

        <FilterField label="Name blank">
          <TriSelect
            value={filters.companyNameBlankFilter}
            onChange={(value) => patch({ companyNameBlankFilter: value })}
            placeholder="Any"
          />
        </FilterField>
      </FilterSection>

      <FilterSection
        title="Geography"
        open={openSections.includes('Geography')}
        onToggle={() => toggleSection('Geography')}
      >
        <FilterField label="Registry state">
          <SearchAndSelectMulti
            items={REGISTRY_STATE_OPTIONS}
            getItemId={(item) => item.id}
            getItemLabel={(item) => `${item.label} (${item.id})`}
            value={filters.registryState}
            onChange={(ids) => patch({ registryState: ids })}
            placeholder="Any state"
            listMaxHeight={160}
            size="compact"
            panelSize="compact"
            noMargin
          />
        </FilterField>

        <FilterField label="Address state">
          <Input value={filters.addressState} onChangeText={(value) => patch({ addressState: value })} placeholder="e.g. Iowa" />
        </FilterField>

        <FilterField label="Address city">
          <Input value={filters.addressCity} onChangeText={(value) => patch({ addressCity: value })} placeholder="City" />
        </FilterField>

        <FilterField label="Postal code">
          <Input value={filters.postalCode} onChangeText={(value) => patch({ postalCode: value })} placeholder="Postal code" />
        </FilterField>

        <FilterField label="Primary location">
          <View className="gap-1.5">
            <Input
              value={filters.primaryLocationCity}
              onChangeText={(value) => patch({ primaryLocationCity: value })}
              placeholder="Primary city"
            />
            <Input
              value={filters.primaryLocationState}
              onChangeText={(value) => patch({ primaryLocationState: value })}
              placeholder="Primary state"
            />
          </View>
        </FilterField>
      </FilterSection>

      {mode === 'contact' ? (
        <FilterSection title="Owner" open={openSections.includes('Owner')} onToggle={() => toggleSection('Owner')}>
          <FilterField label="Has owner row">
            <TriSelect value={filters.ownerFilter} onChange={(value) => patch({ ownerFilter: value })} placeholder="Any" />
          </FilterField>

          <FilterField label="Title contains">
            <Input
              value={filters.ownerTitleQuery}
              onChangeText={(value) => patch({ ownerTitleQuery: value })}
              placeholder="e.g. CEO"
            />
          </FilterField>
        </FilterSection>
      ) : null}

      <FilterSection
        title="Enrichments"
        open={openSections.includes('Enrichments')}
        onToggle={() => toggleSection('Enrichments')}
      >
        <FilterField label="Has website">
          <TriSelect
            value={filters.hasWebsiteFilter}
            onChange={(value) => patch({ hasWebsiteFilter: value })}
            placeholder="Any"
          />
        </FilterField>

        <FilterField label="Google Ads result">
          <GoogleAdsResultSelect
            value={filters.googleAdsResult}
            onChange={(value) => patch({ googleAdsResult: value })}
          />
        </FilterField>
      </FilterSection>

      <FilterSection title="Advanced" open={openSections.includes('Advanced')} onToggle={() => toggleSection('Advanced')}>
        <View className="gap-1.5">
          <FilterField label="Readiness">
            <Tabs
              tabs={READY_TABS}
              activeTab={filters.exportReady}
              onTabChange={(id) => patch({ exportReady: id as ExportReadyFilter })}
              marginBottom={0}
              layout="content"
              textSize={11}
            />
          </FilterField>
          <FilterField label="Linked source">
            <TriSelect value={filters.linkedFilter} onChange={(value) => patch({ linkedFilter: value })} placeholder="Any" />
          </FilterField>
          <FilterField label="Review task">
            <TriSelect value={filters.reviewFilter} onChange={(value) => patch({ reviewFilter: value })} placeholder="Any" />
          </FilterField>
          <FilterField label="Parse task">
            <TriSelect value={filters.parseFilter} onChange={(value) => patch({ parseFilter: value })} placeholder="Any" />
          </FilterField>
          <FilterField label="Normalized key">
            <TriSelect
              value={filters.hasNormalizedKeyFilter}
              onChange={(value) => patch({ hasNormalizedKeyFilter: value })}
              placeholder="Any"
            />
          </FilterField>
        </View>
      </FilterSection>

      {showActions ? (
        <View className="flex-row gap-1.5 pt-1">
          <Button variant="secondary" size="sm" className="flex-1" onPress={onClear}>
            Clear
          </Button>
          <Button variant="default" size="sm" className="flex-1" onPress={onApply}>
            Apply
          </Button>
        </View>
      ) : null}
    </View>
  );
}
