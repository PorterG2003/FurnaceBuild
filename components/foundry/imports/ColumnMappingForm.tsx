import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Select } from '@/components/ui/forms';
import { Card } from '@/components/ui/Card';
import type { ColumnMappingState } from './ImportWizardContext';

const NONE_ID = '__none__';

interface ColumnMappingFormProps {
  headers: string[];
  sampleRows: Record<string, string>[];
  value: ColumnMappingState;
  onChange: (next: ColumnMappingState) => void;
}

function SampleCells({
  rows,
  header,
}: {
  rows: Record<string, string>[];
  header: string;
}) {
  const samples = rows.slice(0, 3).map((r) => (r[header] != null ? String(r[header]) : ''));
  return (
    <Text className="text-gray-500 font-instrument text-xs mt-1" numberOfLines={2}>
      {samples.filter(Boolean).length ? samples.filter(Boolean).join(' · ') : '—'}
    </Text>
  );
}

export function ColumnMappingForm({ headers, sampleRows, value, onChange }: ColumnMappingFormProps) {
  const optionalItems = useMemo(() => [NONE_ID, ...headers], [headers]);

  return (
    <View className="gap-4">
      <Text className="text-sm text-gray-300 font-instrument">
        Map each Foundry field to a column from your file. Business name and full address are required.
      </Text>

      <Card variant="card">
        <Select<string>
          searchable={false}
          items={headers}
          getItemId={(c) => c}
          getItemLabel={(c) => ({ primary: c })}
          value={value.nameRawHeader || null}
          onChange={(id) => onChange({ ...value, nameRawHeader: id ?? '' })}
          label="Business name → name_raw *"
          placeholder="Select column…"
          noMargin
        />
        {value.nameRawHeader ? <SampleCells rows={sampleRows} header={value.nameRawHeader} /> : null}
      </Card>

      <Card variant="card">
        <Select<string>
          searchable={false}
          items={headers}
          getItemId={(c) => c}
          getItemLabel={(c) => ({ primary: c })}
          value={value.addressRawHeader || null}
          onChange={(id) => onChange({ ...value, addressRawHeader: id ?? '' })}
          label="Full address → address_raw *"
          placeholder="Select column…"
          noMargin
        />
        {value.addressRawHeader ? (
          <SampleCells rows={sampleRows} header={value.addressRawHeader} />
        ) : null}
      </Card>

      <Card variant="card">
        <Select<string>
          searchable={false}
          items={optionalItems}
          getItemId={(c) => c}
          getItemLabel={(c) => ({ primary: c === NONE_ID ? '(none)' : c })}
          value={value.websiteHeader === null ? NONE_ID : value.websiteHeader}
          onChange={(id) =>
            onChange({
              ...value,
              websiteHeader: !id || id === NONE_ID ? null : id,
            })
          }
          label="Domain / website → website (optional)"
          placeholder="Select column…"
          noMargin
        />
        {value.websiteHeader ? <SampleCells rows={sampleRows} header={value.websiteHeader} /> : null}
      </Card>

      <Card variant="card">
        <Select<string>
          searchable={false}
          items={optionalItems}
          getItemId={(c) => c}
          getItemLabel={(c) => ({ primary: c === NONE_ID ? '(none)' : c })}
          value={value.phoneHeader === null ? NONE_ID : value.phoneHeader}
          onChange={(id) =>
            onChange({
              ...value,
              phoneHeader: !id || id === NONE_ID ? null : id,
            })
          }
          label="Phone → phone (optional)"
          placeholder="Select column…"
          noMargin
        />
        {value.phoneHeader ? <SampleCells rows={sampleRows} header={value.phoneHeader} /> : null}
      </Card>
    </View>
  );
}
