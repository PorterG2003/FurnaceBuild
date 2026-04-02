ALTER TABLE foundry_jobs
  DROP CONSTRAINT foundry_jobs_job_type_check;

ALTER TABLE foundry_jobs
  ADD CONSTRAINT foundry_jobs_job_type_check CHECK (
    job_type IN (
      'normalize_ingestion_run',
      'autolink_ingestion_run',
      'bulk_source_resolution',
      'state_matching_batch'
    )
  );
