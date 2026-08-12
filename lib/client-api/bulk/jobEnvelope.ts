import type { ApiBulkExclusions, ApiBulkScope } from './scope.js';

export type LogicalBulkJobStatus =
  | 'uploading'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type LogicalBulkJobArtifact = {
  kind: 'csv' | 'json' | 'object';
  filename?: string | null;
  download_url?: string | null;
  content_type?: string | null;
  byte_size?: number | null;
  rows_exported?: number | null;
};

export type LogicalBulkJobEnvelope = {
  id: string;
  account_id: string;
  campaign_id: string | null;
  status: LogicalBulkJobStatus;
  operation: string;
  progress: number;
  cursor: number;
  scope: ApiBulkScope | null;
  exclusions: ApiBulkExclusions | null;
  preview_id: string | null;
  expected_count: number | null;
  cancel_requested: boolean;
  result: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
  artifact: LogicalBulkJobArtifact | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export function extractJobArtifact(result: Record<string, unknown> | null | undefined): LogicalBulkJobArtifact | null {
  if (!result) return null;
  const downloadUrl = typeof result.download_url === 'string' ? result.download_url : null;
  const filename = typeof result.filename === 'string' ? result.filename : null;
  if (!downloadUrl && !filename) return null;
  return {
    kind: 'csv',
    filename,
    download_url: downloadUrl,
    content_type: typeof result.content_type === 'string' ? result.content_type : 'text/csv',
    byte_size: typeof result.byte_size === 'number' ? result.byte_size : null,
    rows_exported: typeof result.rows_exported === 'number' ? result.rows_exported : null,
  };
}
