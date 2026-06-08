import { LEADS_EXPORT_SYNC_THRESHOLD } from './constants';

export async function startLeadsExport<T>(params: {
  rowCount: number;
  onSyncExport: () => Promise<T>;
  onAsyncExport: () => Promise<{ jobId: string }>;
}): Promise<{ mode: 'sync'; result: T } | { mode: 'async'; jobId: string }> {
  if (params.rowCount <= LEADS_EXPORT_SYNC_THRESHOLD) {
    return {
      mode: 'sync',
      result: await params.onSyncExport(),
    };
  }

  const asyncResult = await params.onAsyncExport();
  return {
    mode: 'async',
    jobId: asyncResult.jobId,
  };
}
