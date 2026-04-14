ALTER TABLE csv_builder_columns
  ADD COLUMN IF NOT EXISTS tool_job_id UUID,
  ADD COLUMN IF NOT EXISTS tool_output_key TEXT,
  ADD COLUMN IF NOT EXISTS tool_output_label TEXT;

CREATE INDEX IF NOT EXISTS idx_csv_builder_columns_run_tool_job
  ON csv_builder_columns (run_id, tool_job_id, position);

ALTER TABLE csv_builder_column_jobs
  ADD COLUMN IF NOT EXISTS output_column_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS selected_output_keys TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS result_parser_version TEXT;

UPDATE csv_builder_column_jobs
SET output_column_ids = CASE
  WHEN array_length(output_column_ids, 1) IS NULL AND column_id IS NOT NULL THEN ARRAY[column_id]
  ELSE output_column_ids
END,
selected_output_keys = COALESCE(selected_output_keys, '{}'::text[]),
result_parser_version = COALESCE(NULLIF(result_parser_version, ''), 'v1');

ALTER TABLE foundry_jobs DROP CONSTRAINT IF EXISTS foundry_jobs_job_type_check;

ALTER TABLE foundry_jobs
  ADD CONSTRAINT foundry_jobs_job_type_check CHECK (
    job_type IN (
      'normalize_ingestion_run',
      'autolink_ingestion_run',
      'contact_enrichment_import_run',
      'bulk_source_resolution',
      'state_matching_batch',
      'website_verification_import_run',
      'google_ads_verification_import_run',
      'csv_builder_website_verification',
      'csv_builder_google_ads_verification',
      'csv_builder_export'
    )
  );
