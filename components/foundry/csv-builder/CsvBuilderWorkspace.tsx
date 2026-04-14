import { View } from 'react-native';
import { Card } from '@/components/ui/Card';
import type { CsvBuilderColumnRow, CsvBuilderHydratedRow, CsvBuilderRunRow, CsvBuilderToolJobRow } from '@/lib/foundry/registry-types';
import { CsvBuilderColumnsBar } from './CsvBuilderColumnsBar';
import { CsvBuilderTable } from './CsvBuilderTable';
import { CsvBuilderToolPanel } from './CsvBuilderToolPanel';

export function CsvBuilderWorkspace({
  run,
  columns,
  toolJobs,
  rows,
  loadingRows = false,
  onRefresh,
  currentPage = 1,
  totalItems = 0,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
  onRerunJob,
  rerunningJobId,
}: {
  run: CsvBuilderRunRow;
  columns: CsvBuilderColumnRow[];
  toolJobs: CsvBuilderToolJobRow[];
  rows: CsvBuilderHydratedRow[];
  loadingRows?: boolean;
  onRefresh: () => Promise<void>;
  currentPage?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (columnKey: string, direction: 'asc' | 'desc') => void;
  onRerunJob?: (toolJobId: string) => Promise<void>;
  rerunningJobId?: string | null;
}) {
  return (
    <View className="gap-4">
      <Card variant="card">
        <CsvBuilderColumnsBar columns={columns} toolJobs={toolJobs} onRerunJob={onRerunJob} rerunningJobId={rerunningJobId} />
      </Card>
      <View className="gap-4 xl:flex-row">
        <View className="flex-1 min-w-0">
          <CsvBuilderTable
            columns={columns.filter((column) => column.visible)}
            rows={rows}
            loading={loadingRows}
            currentPage={currentPage}
            totalItems={totalItems}
            onPageChange={onPageChange}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSortChange={onSortChange}
          />
        </View>
        <View className="xl:w-[360px]">
          <Card variant="card">
            <CsvBuilderToolPanel runId={run.id} columns={columns} onRefresh={onRefresh} />
          </Card>
        </View>
      </View>
    </View>
  );
}
