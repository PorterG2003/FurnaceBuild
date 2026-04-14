import { ScrollView, View, Text } from 'react-native';
import { Button } from '@/components/ui/button';
import type { CsvBuilderColumnRow, CsvBuilderToolJobRow } from '@/lib/foundry/registry-types';

function statusColor(status: string): string {
  if (status === 'failed') return 'text-red-400';
  if (status === 'partial') return 'text-amber-400';
  if (status === 'running' || status === 'queued') return 'text-blue-400';
  return 'text-emerald-400';
}

export function CsvBuilderColumnsBar({
  columns,
  toolJobs,
  onRerunJob,
  rerunningJobId,
}: {
  columns: CsvBuilderColumnRow[];
  toolJobs?: CsvBuilderToolJobRow[];
  onRerunJob?: (toolJobId: string) => Promise<void>;
  rerunningJobId?: string | null;
}) {
  const sourceColumns = columns.filter((column) => column.kind === 'source');
  const toolJobsById = new Map((toolJobs ?? []).map((job) => [job.id, job]));
  const groupedToolColumns = Array.from(
    columns
      .filter((column) => column.kind === 'tool_output' && column.tool_job_id)
      .reduce<Map<string, CsvBuilderColumnRow[]>>((acc, column) => {
        const key = column.tool_job_id as string;
        const list = acc.get(key) ?? [];
        list.push(column);
        acc.set(key, list);
        return acc;
      }, new Map())
      .entries(),
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="flex-row gap-2">
        <View className="border border-[#2A2A2A] rounded-lg px-3 py-2 bg-[#181818] min-w-[180px]">
          <Text className="text-white font-instrument-medium text-sm">Source columns</Text>
          <Text className="text-gray-500 font-instrument text-[11px] mt-1">{sourceColumns.length} columns</Text>
        </View>
        {groupedToolColumns.map(([toolJobId, jobColumns]) => {
          const primary = [...jobColumns].sort((a, b) => a.position - b.position)[0];
          const groupLabel = primary.label.split(':')[0]?.trim() || primary.label;
          const toolJob = toolJobsById.get(toolJobId);
          const rowsCompleted = toolJob?.rows_completed ?? null;
          const rowsTotal = toolJob?.rows_total ?? null;
          const rowsFailed = toolJob?.rows_failed ?? null;
          const status = toolJob?.status ?? primary.status;
          return (
            <View key={toolJobId} className="border border-[#2A2A2A] rounded-lg px-3 py-2 bg-[#181818] min-w-[220px]">
              <Text className="text-white font-instrument-medium text-sm" numberOfLines={1}>
                {groupLabel}
              </Text>
              <Text className="text-gray-500 font-instrument text-[11px] mt-1">
                {jobColumns.length} outputs · {primary.tool_type ? primary.tool_type.replace(/_/g, ' ') : 'tool'}
              </Text>
              <Text className={`${statusColor(status)} font-instrument text-[11px] mt-1`}>
                {status.replace(/_/g, ' ')}
              </Text>
              {rowsTotal != null ? (
                <Text className="text-gray-500 font-instrument text-[11px] mt-1">
                  {rowsCompleted ?? 0} / {rowsTotal} rows{rowsFailed ? ` · ${rowsFailed} failed` : ''}
                </Text>
              ) : null}
              {onRerunJob ? (
                <View className="mt-2 self-start">
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={rerunningJobId === toolJobId}
                    onPress={() => void onRerunJob(toolJobId)}
                  >
                    {rerunningJobId === toolJobId ? 'Rerunning…' : 'Rerun'}
                  </Button>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
