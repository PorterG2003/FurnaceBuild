import { Text, TextInput, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/forms/Select';
import { getCsvBuilderToolManifest, listCsvBuilderToolManifests } from '@/lib/foundry/csv-builder';
import type { CsvBuilderColumnRow } from '@/lib/foundry/registry-types';
import { useCsvBuilderAddColumnWizard } from './CsvBuilderAddColumnWizardContext';

export const CSV_BUILDER_WIZARD_STEPS = ['Tool', 'Inputs', 'Outputs', 'Review'] as const;

function columnSecondaryLabel(column: CsvBuilderColumnRow): string {
  if (column.kind === 'source') return 'Source column';
  if (column.tool_type) {
    return `${column.tool_type.replace(/_/g, ' ')}${column.tool_output_label ? ` · ${column.tool_output_label}` : ''}`;
  }
  return 'Derived column';
}

export function CsvBuilderToolSelectionStep() {
  const { selectTool } = useCsvBuilderAddColumnWizard();
  return (
    <View className="gap-3">
      <Text className="text-gray-400 font-instrument text-sm">
        Choose a CSV Builder tool. Verification tools run as background jobs and can create multiple output columns.
      </Text>
      {listCsvBuilderToolManifests().map((tool) => (
        <Card key={tool.tool_type} variant="card">
          <Text className="text-white font-instrument-semibold text-base">{tool.label}</Text>
          <Text className="text-gray-400 font-instrument text-sm mt-2 leading-5">{tool.description}</Text>
          <Text className="text-gray-500 font-instrument text-xs mt-2">
            {tool.supported ? `${tool.inputs.length} inputs · ${tool.outputs.length} outputs` : 'Coming soon'}
          </Text>
          <View className="mt-4">
            <Text
              className={`font-instrument text-sm ${tool.supported ? 'text-brand-orange' : 'text-gray-500'}`}
              onPress={() => {
                if (tool.supported) selectTool(tool.tool_type);
              }}
            >
              {tool.supported ? 'Choose tool' : 'Unavailable'}
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

export function CsvBuilderInputMappingStep({ columns }: { columns: CsvBuilderColumnRow[] }) {
  const { toolType, label, setLabel, inputMapping, setInputMapping } = useCsvBuilderAddColumnWizard();
  if (!toolType) return null;
  const manifest = getCsvBuilderToolManifest(toolType);
  return (
    <View className="gap-4">
      <View>
        <Text className="text-gray-300 font-instrument-semibold text-sm mb-2">Column group label</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder={manifest.label}
          placeholderTextColor="#6B7280"
          className="border border-[#2A2A2A] rounded-xl bg-[#121212] px-3 py-3 text-white font-instrument"
        />
      </View>
      {manifest.inputs.map((input) => {
        const eligibleColumns = columns.filter((column) =>
          input.accepts_column_kinds?.length ? input.accepts_column_kinds.includes(column.kind) : true,
        );
        return (
          <View key={input.key}>
            <Select<CsvBuilderColumnRow>
              items={eligibleColumns}
              getItemId={(item) => item.id}
              getItemLabel={(item) => ({ primary: item.label, secondary: columnSecondaryLabel(item) })}
              value={inputMapping[input.key] ?? null}
              onChange={(id) => {
                setInputMapping((current) => ({ ...current, [input.key]: id }));
              }}
              label={`${input.label}${input.required ? ' *' : ''}`}
              placeholder={input.required ? `Select ${input.label.toLowerCase()}` : `Optional ${input.label.toLowerCase()}`}
              emptyMessage={() => 'No matching columns available.'}
              searchable
              onSearchChange={() => {}}
            />
            {input.description ? (
              <Text className="text-gray-500 font-instrument text-xs mt-1 leading-5">{input.description}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function CsvBuilderOutputSelectionStep() {
  const { toolType, selectedOutputs, setSelectedOutputs, includeRawJson, setIncludeRawJson } = useCsvBuilderAddColumnWizard();
  if (!toolType) return null;
  const manifest = getCsvBuilderToolManifest(toolType);
  return (
    <View className="gap-3">
      {manifest.outputs.map((output) => {
        const checked = output.is_raw_json ? includeRawJson : selectedOutputs.includes(output.key);
        return (
          <Card key={output.key} variant="card">
            <View className="flex-row items-start gap-3">
              <Checkbox
                checked={checked}
                onPress={() => {
                  if (output.is_raw_json) {
                    setIncludeRawJson((current) => !current);
                    return;
                  }
                  setSelectedOutputs((current) =>
                    current.includes(output.key)
                      ? current.filter((key) => key !== output.key)
                      : [...current, output.key],
                  );
                }}
              />
              <View className="flex-1">
                <Text className="text-white font-instrument-medium text-sm">{output.label}</Text>
                <Text className="text-gray-400 font-instrument text-xs mt-1 leading-5">{output.description}</Text>
                <Text className="text-gray-500 font-instrument text-[11px] mt-2 uppercase tracking-wider">
                  {output.data_type}
                </Text>
              </View>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

export function CsvBuilderReviewStep({ columns }: { columns: CsvBuilderColumnRow[] }) {
  const { toolType, label, inputMapping, selectedOutputs, includeRawJson } = useCsvBuilderAddColumnWizard();
  if (!toolType) return null;
  const manifest = getCsvBuilderToolManifest(toolType);
  return (
    <View className="gap-4">
      <Card variant="card">
        <Text className="text-white font-instrument-semibold text-base">{label || manifest.label}</Text>
        <Text className="text-gray-400 font-instrument text-sm mt-2">{manifest.description}</Text>
      </Card>
      <Card variant="card">
        <Text className="text-white font-instrument-semibold text-sm">Input mapping</Text>
        {manifest.inputs.map((input) => {
          const column = columns.find((item) => item.id === inputMapping[input.key]);
          return (
            <View key={input.key} className="mt-3">
              <Text className="text-gray-500 font-instrument text-[11px] uppercase tracking-wider">{input.label}</Text>
              <Text className="text-gray-200 font-instrument text-sm mt-1">{column?.label ?? 'Not mapped'}</Text>
            </View>
          );
        })}
      </Card>
      <Card variant="card">
        <Text className="text-white font-instrument-semibold text-sm">Outputs</Text>
        {manifest.outputs
          .filter((output) => (output.is_raw_json ? includeRawJson : selectedOutputs.includes(output.key)))
          .map((output) => (
            <View key={output.key} className="mt-3">
              <Text className="text-gray-200 font-instrument text-sm">{output.label}</Text>
              <Text className="text-gray-500 font-instrument text-xs mt-1">{output.data_type}</Text>
            </View>
          ))}
      </Card>
    </View>
  );
}
