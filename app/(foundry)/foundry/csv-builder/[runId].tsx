import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Breadcrumb, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback/Alert';
import {
  fetchCsvBuilderColumns,
  fetchCsvBuilderRows,
  fetchCsvBuilderRun,
  fetchFoundryJob,
  postCsvBuilderExport,
  rerunCsvBuilderToolJob,
} from '@/lib/foundry/registry-client';
import type { CsvBuilderColumnRow, CsvBuilderHydratedRow, CsvBuilderRunRow } from '@/lib/foundry/registry-types';
import { CsvBuilderExportModal, CsvBuilderWorkspace } from '@/components/foundry/csv-builder';
import {
  getCsvBuilderExportDownloadUrl,
  openCsvBuilderExportDownload,
} from '@/components/foundry/runs/foundryJobDisplay';

const EXPORT_POLL_MS = 2000;

export default function CsvBuilderRunPage() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const [run, setRun] = useState<CsvBuilderRunRow | null>(null);
  const [columns, setColumns] = useState<CsvBuilderColumnRow[]>([]);
  const [rows, setRows] = useState<CsvBuilderHydratedRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string>('row_number');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [rerunningJobId, setRerunningJobId] = useState<string | null>(null);
  const [watchedExportJobId, setWatchedExportJobId] = useState<string | null>(null);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportModalPhase, setExportModalPhase] = useState<'running' | 'failed'>('running');
  const [exportPollError, setExportPollError] = useState<string | null>(null);
  const exportDownloadOpenedRef = useRef(false);

  const visibleColumnKeys = useMemo(
    () => columns.filter((column) => column.visible).map((column) => column.key),
    [columns],
  );

  const load = useCallback(async () => {
    if (!runId || typeof runId !== 'string') return;
    setLoading(true);
    setError(null);
    try {
      const [runResult, columnsResult] = await Promise.all([
        fetchCsvBuilderRun(runId),
        fetchCsvBuilderColumns(runId),
      ]);
      setRun(runResult.run);
      setColumns(columnsResult.columns);
      const columnKeys = columnsResult.columns.filter((column) => column.visible).map((column) => column.key);
      const rowsResult = await fetchCsvBuilderRows(runId, {
        limit: 50,
        offset: (page - 1) * 50,
        columnKeys,
        sortBy: sortColumn === 'row_number' ? undefined : sortColumn,
        sortDirection,
      });
      setRows(rowsResult.rows);
      setTotalRows(rowsResult.total_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load CSV Builder run');
      setRun(null);
      setColumns([]);
      setRows([]);
      setTotalRows(0);
    } finally {
      setLoading(false);
    }
  }, [page, runId, sortColumn, sortDirection]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!watchedExportJobId) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const { job } = await fetchFoundryJob(watchedExportJobId);
        if (cancelled) return;

        if (job.status === 'completed') {
          const url = getCsvBuilderExportDownloadUrl(job);
          if (url) {
            if (!exportDownloadOpenedRef.current) {
              exportDownloadOpenedRef.current = true;
              openCsvBuilderExportDownload(url);
            }
            setWatchedExportJobId(null);
            setExportModalVisible(false);
            setExportModalPhase('running');
            setExportPollError(null);
            return;
          }
        }

        if (job.status === 'failed') {
          setExportModalPhase('failed');
          setExportPollError(job.error_summary ?? 'Export failed');
          setExportModalVisible(true);
          setWatchedExportJobId(null);
        }
      } catch (e) {
        if (cancelled) return;
        setExportModalPhase('failed');
        setExportPollError(e instanceof Error ? e.message : 'Failed to check export status');
        setExportModalVisible(true);
        setWatchedExportJobId(null);
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), EXPORT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [watchedExportJobId]);

  const onExportModalClose = useCallback(() => {
    setExportModalVisible(false);
    if (exportModalPhase === 'failed') {
      setExportModalPhase('running');
      setExportPollError(null);
    }
  }, [exportModalPhase]);

  if (!runId || typeof runId !== 'string') {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500 font-instrument">Invalid CSV Builder run.</Text>
      </View>
    );
  }

  const exportInFlight = Boolean(watchedExportJobId);

  return (
    <>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View className="mb-4">
          <Breadcrumb
            items={[
              { label: 'Foundry', href: '/foundry' },
              { label: 'CSV Builder', href: '/foundry/csv-builder' },
              { label: run?.name || 'Run' },
            ]}
          />
        </View>
        <PageHeader
          title={run?.name || 'CSV Builder run'}
          subtitle={run ? `${run.source_row_count} rows · ${visibleColumnKeys.length} visible columns loaded` : undefined}
          primaryAction={
            <View className="flex-row gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={exportBusy || exportInFlight || !run}
                onPress={async () => {
                  if (!run) return;
                  setExportBusy(true);
                  setError(null);
                  exportDownloadOpenedRef.current = false;
                  try {
                    const result = await postCsvBuilderExport(run.id, {
                      column_keys: visibleColumnKeys,
                      sort_by: sortColumn === 'row_number' ? undefined : sortColumn,
                      sort_direction: sortDirection,
                    });
                    setExportModalPhase('running');
                    setExportPollError(null);
                    setExportModalVisible(true);
                    setWatchedExportJobId(result.jobId);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to start CSV Builder export');
                  } finally {
                    setExportBusy(false);
                  }
                }}
              >
                {exportBusy ? 'Starting export…' : 'Export CSV'}
              </Button>
              <Button size="sm" variant="secondary" onPress={() => void load()}>
                Refresh
              </Button>
            </View>
          }
        />
        {error ? <Alert variant="error" message={error} /> : null}
        {!run && !error ? <Text className="text-gray-500 font-instrument">Loading…</Text> : null}
        {run ? (
          <CsvBuilderWorkspace
            run={run}
            columns={columns}
            rows={rows}
            loadingRows={loading}
            onRefresh={load}
            currentPage={page}
            totalItems={totalRows}
            onPageChange={setPage}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSortChange={(columnKey, direction) => {
              setSortColumn(columnKey);
              setSortDirection(direction);
              setPage(1);
            }}
            rerunningJobId={rerunningJobId}
            onRerunJob={async (toolJobId) => {
              setRerunningJobId(toolJobId);
              setError(null);
              try {
                await rerunCsvBuilderToolJob(toolJobId);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to rerun CSV Builder tool job');
              } finally {
                setRerunningJobId(null);
              }
            }}
          />
        ) : null}
      </ScrollView>
      <CsvBuilderExportModal
        visible={exportModalVisible}
        onClose={onExportModalClose}
        phase={exportModalPhase}
        errorMessage={exportPollError}
      />
    </>
  );
}
