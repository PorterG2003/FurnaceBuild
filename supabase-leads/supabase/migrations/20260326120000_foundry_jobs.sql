-- Async Foundry jobs (Step Functions orchestration); polled by admin app via registry API.

CREATE TABLE foundry_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT,
  idempotency_key TEXT,
  step_function_execution_arn TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT foundry_jobs_job_type_check CHECK (
    job_type IN (
      'normalize_ingestion_run',
      'bulk_source_resolution',
      'state_matching_batch'
    )
  ),
  CONSTRAINT foundry_jobs_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  )
);

CREATE INDEX idx_foundry_jobs_status_created ON foundry_jobs (status, created_at DESC);

CREATE UNIQUE INDEX uniq_foundry_jobs_idempotency_active
  ON foundry_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('queued', 'running');

COMMENT ON TABLE foundry_jobs IS
  'Long-running Foundry work tracked for polling; step_function_execution_arn ties to AWS orchestration.';

CREATE TRIGGER trg_foundry_jobs_updated_at
  BEFORE UPDATE ON foundry_jobs
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

ALTER TABLE foundry_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON foundry_jobs FROM anon, authenticated;
