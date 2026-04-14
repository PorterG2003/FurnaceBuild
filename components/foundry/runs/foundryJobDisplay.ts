import { Linking } from 'react-native';
import type { FoundryJobRow } from '@/lib/foundry/registry-types';

export function formatFoundryJobType(jobType: string): string {
  switch (jobType) {
    case 'normalize_ingestion_run':
      return 'Normalize records';
    case 'autolink_ingestion_run':
      return 'Auto-link records';
    case 'contact_enrichment_import_run':
      return 'Contact enrichment';
    case 'state_matching_batch':
      return 'State matching';
    case 'website_verification_import_run':
      return 'Website verify';
    case 'google_ads_verification_import_run':
      return 'Google Ads verify';
    case 'csv_builder_website_verification':
      return 'CSV Builder website verify';
    case 'csv_builder_google_ads_verification':
      return 'CSV Builder Google Ads';
    case 'csv_builder_export':
      return 'CSV Builder export';
    case 'bulk_source_resolution':
      return 'Bulk resolution';
    default:
      return jobType;
  }
}

export function getIngestionRunIdFromJob(job: FoundryJobRow): string | null {
  if (
    job.job_type !== 'normalize_ingestion_run' &&
    job.job_type !== 'autolink_ingestion_run' &&
    job.job_type !== 'contact_enrichment_import_run'
  ) {
    return null;
  }
  const id = job.payload?.ingestion_run_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function getSourceIngestionRunIdFromJob(job: FoundryJobRow): string | null {
  const id = job.payload?.source_ingestion_run_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Completed CSV Builder export jobs expose a presigned URL (expires ~15 minutes). */
export function getCsvBuilderExportDownloadUrl(job: FoundryJobRow): string | null {
  if (job.job_type !== 'csv_builder_export' || job.status !== 'completed') return null;
  const url = job.progress?.download_url;
  return typeof url === 'string' && url.trim().length > 0 ? url.trim() : null;
}

export function openCsvBuilderExportDownload(url: string): void {
  void Linking.openURL(url);
}
