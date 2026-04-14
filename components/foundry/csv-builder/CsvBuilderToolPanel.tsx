import { useState } from 'react';
import { View, Text } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { listCsvBuilderToolManifests } from '@/lib/foundry/csv-builder';
import type { CsvBuilderColumnRow } from '@/lib/foundry/registry-types';
import { CsvBuilderAddColumnWizard } from './CsvBuilderAddColumnWizard';

export function CsvBuilderToolPanel({
  runId,
  columns,
  onRefresh,
}: {
  runId: string;
  columns: CsvBuilderColumnRow[];
  onRefresh: () => Promise<void>;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const groupedToolColumns = columns.filter((column) => column.kind === 'tool_output');

  return (
    <View className="gap-3">
      <Text className="text-white font-instrument-semibold text-base">Add column</Text>
      <Text className="text-gray-500 font-instrument text-sm leading-5">
        Launch the existing multi-step wizard pattern to map inputs, choose outputs, and start a background tool job.
      </Text>
      <Button onPress={() => setWizardOpen(true)}>Open add-column wizard</Button>
      <View className="gap-2 mt-2">
        {listCsvBuilderToolManifests()
          .filter((tool) => tool.supported)
          .map((tool) => (
            <Card key={tool.tool_type} variant="card">
              <Text className="text-white font-instrument-medium text-sm">{tool.label}</Text>
              <Text className="text-gray-400 font-instrument text-xs mt-2 leading-5">{tool.description}</Text>
              <Text className="text-gray-500 font-instrument text-xs mt-2">
                {tool.inputs.length} inputs · {tool.outputs.length} outputs
              </Text>
            </Card>
          ))}
      </View>
      <Text className="text-gray-500 font-instrument text-xs mt-1">
        {groupedToolColumns.length} tool-backed columns currently exist in this run.
      </Text>
      <CsvBuilderAddColumnWizard
        visible={wizardOpen}
        runId={runId}
        columns={columns}
        onClose={() => setWizardOpen(false)}
        onCreated={onRefresh}
      />
    </View>
  );
}
