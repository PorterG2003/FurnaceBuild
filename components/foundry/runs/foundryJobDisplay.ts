import type { FoundryJobRow } from '@/lib/foundry/registry-types';

export function formatFoundryJobType(jobType: string): string {
  switch (jobType) {
    case 'normalize_ingestion_run':
      return 'Normalize records';
    case 'state_matching_batch':
      return 'State matching';
    case 'bulk_source_resolution':
      return 'Bulk resolution';
    default:
      return jobType;
  }
}

export function getIngestionRunIdFromJob(job: FoundryJobRow): string | null {
  if (job.job_type !== 'normalize_ingestion_run') return null;
  const id = job.payload?.ingestion_run_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function getSourceIngestionRunIdFromJob(job: FoundryJobRow): string | null {
  const id = job.payload?.source_ingestion_run_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
