ALTER TABLE csv_builder_column_jobs
  ADD COLUMN IF NOT EXISTS batch_size INTEGER,
  ADD COLUMN IF NOT EXISTS batch_count INTEGER,
  ADD COLUMN IF NOT EXISTS max_concurrency INTEGER;

CREATE TABLE IF NOT EXISTS csv_builder_tool_job_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_job_id UUID NOT NULL REFERENCES csv_builder_column_jobs(id) ON DELETE CASCADE,
  foundry_job_id UUID REFERENCES foundry_jobs(id) ON DELETE SET NULL,
  batch_index INTEGER NOT NULL,
  row_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csv_builder_tool_job_batches_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT csv_builder_tool_job_batches_batch_index_check CHECK (batch_index >= 0),
  CONSTRAINT csv_builder_tool_job_batches_row_count_check CHECK (row_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_csv_builder_tool_job_batches_job_index
  ON csv_builder_tool_job_batches (tool_job_id, batch_index);
CREATE INDEX IF NOT EXISTS idx_csv_builder_tool_job_batches_job_status
  ON csv_builder_tool_job_batches (tool_job_id, status, batch_index);
CREATE INDEX IF NOT EXISTS idx_csv_builder_tool_job_batches_foundry_job
  ON csv_builder_tool_job_batches (foundry_job_id, batch_index);

CREATE TRIGGER trg_csv_builder_tool_job_batches_updated_at
  BEFORE UPDATE ON csv_builder_tool_job_batches
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TABLE IF NOT EXISTS csv_builder_tool_job_row_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_job_id UUID NOT NULL REFERENCES csv_builder_column_jobs(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES csv_builder_tool_job_batches(id) ON DELETE SET NULL,
  row_id UUID NOT NULL REFERENCES csv_builder_rows(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  tool_type TEXT NOT NULL,
  status TEXT NOT NULL,
  failed BOOLEAN NOT NULL DEFAULT false,
  outcome_code TEXT,
  error_summary TEXT,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_patch JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csv_builder_tool_job_row_results_row_number_check CHECK (row_number >= 1),
  CONSTRAINT csv_builder_tool_job_row_results_status_check CHECK (
    status IN ('completed', 'failed', 'skipped')
  ),
  CONSTRAINT csv_builder_tool_job_row_results_result_payload_object_check CHECK (jsonb_typeof(result_payload) = 'object'),
  CONSTRAINT csv_builder_tool_job_row_results_output_patch_object_check CHECK (jsonb_typeof(output_patch) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_csv_builder_tool_job_row_results_job_row
  ON csv_builder_tool_job_row_results (tool_job_id, row_id);
CREATE INDEX IF NOT EXISTS idx_csv_builder_tool_job_row_results_batch
  ON csv_builder_tool_job_row_results (batch_id, row_number);
CREATE INDEX IF NOT EXISTS idx_csv_builder_tool_job_row_results_job_status
  ON csv_builder_tool_job_row_results (tool_job_id, status, row_number);
CREATE INDEX IF NOT EXISTS idx_csv_builder_tool_job_row_results_row
  ON csv_builder_tool_job_row_results (row_id, tool_job_id);

CREATE TRIGGER trg_csv_builder_tool_job_row_results_updated_at
  BEFORE UPDATE ON csv_builder_tool_job_row_results
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE OR REPLACE FUNCTION apply_csv_builder_tool_job_row_result(
  p_tool_job_id UUID,
  p_batch_id UUID,
  p_row_id UUID,
  p_row_number INTEGER,
  p_tool_type TEXT,
  p_status TEXT,
  p_failed BOOLEAN,
  p_outcome_code TEXT,
  p_error_summary TEXT,
  p_result_payload JSONB,
  p_output_patch JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_failed_exists BOOLEAN;
BEGIN
  INSERT INTO csv_builder_tool_job_row_results (
    tool_job_id,
    batch_id,
    row_id,
    row_number,
    tool_type,
    status,
    failed,
    outcome_code,
    error_summary,
    result_payload,
    output_patch,
    processed_at
  )
  VALUES (
    p_tool_job_id,
    p_batch_id,
    p_row_id,
    p_row_number,
    p_tool_type,
    p_status,
    COALESCE(p_failed, false),
    NULLIF(btrim(COALESCE(p_outcome_code, '')), ''),
    NULLIF(btrim(COALESCE(p_error_summary, '')), ''),
    COALESCE(p_result_payload, '{}'::jsonb),
    COALESCE(p_output_patch, '{}'::jsonb),
    now()
  )
  ON CONFLICT (tool_job_id, row_id)
  DO UPDATE SET
    batch_id = EXCLUDED.batch_id,
    row_number = EXCLUDED.row_number,
    tool_type = EXCLUDED.tool_type,
    status = EXCLUDED.status,
    failed = EXCLUDED.failed,
    outcome_code = EXCLUDED.outcome_code,
    error_summary = EXCLUDED.error_summary,
    result_payload = EXCLUDED.result_payload,
    output_patch = EXCLUDED.output_patch,
    processed_at = EXCLUDED.processed_at,
    updated_at = now();

  SELECT EXISTS (
    SELECT 1
    FROM csv_builder_tool_job_row_results
    WHERE row_id = p_row_id
      AND failed = true
  )
  INTO v_failed_exists;

  UPDATE csv_builder_rows
  SET
    tool_values = COALESCE(tool_values, '{}'::jsonb) || COALESCE(p_output_patch, '{}'::jsonb),
    row_status = CASE
      WHEN v_failed_exists THEN 'partial'
      ELSE 'ready'
    END
  WHERE id = p_row_id;
END;
$$;

COMMENT ON FUNCTION apply_csv_builder_tool_job_row_result(UUID, UUID, UUID, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, JSONB, JSONB) IS
  'Upserts one CSV Builder tool-job row result, atomically merges the output patch into csv_builder_rows.tool_values, and recomputes the row status from all known tool-job failures for that row.';

CREATE OR REPLACE FUNCTION get_csv_builder_tool_job_progress(p_tool_job_id UUID)
RETURNS TABLE (
  rows_total BIGINT,
  rows_completed BIGINT,
  rows_failed BIGINT,
  batches_total BIGINT,
  batches_completed BIGINT,
  batches_failed BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH batch_counts AS (
    SELECT
      COALESCE(SUM(row_count), 0)::BIGINT AS rows_total,
      COUNT(*)::BIGINT AS batches_total,
      COUNT(*) FILTER (WHERE status = 'completed')::BIGINT AS batches_completed,
      COUNT(*) FILTER (WHERE status = 'failed')::BIGINT AS batches_failed
    FROM csv_builder_tool_job_batches
    WHERE tool_job_id = p_tool_job_id
  ),
  row_counts AS (
    SELECT
      COUNT(*)::BIGINT AS rows_completed,
      COUNT(*) FILTER (WHERE failed = true)::BIGINT AS rows_failed
    FROM csv_builder_tool_job_row_results
    WHERE tool_job_id = p_tool_job_id
  )
  SELECT
    batch_counts.rows_total,
    row_counts.rows_completed,
    row_counts.rows_failed,
    batch_counts.batches_total,
    batch_counts.batches_completed,
    batch_counts.batches_failed
  FROM batch_counts
  CROSS JOIN row_counts;
$$;

COMMENT ON FUNCTION get_csv_builder_tool_job_progress(UUID) IS
  'Returns aggregate row and batch progress for one CSV Builder tool job.';

CREATE OR REPLACE FUNCTION get_csv_builder_website_verification_tool_job_progress(p_tool_job_id UUID)
RETURNS TABLE (
  rows_total BIGINT,
  rows_completed BIGINT,
  rows_failed BIGINT,
  batches_total BIGINT,
  batches_completed BIGINT,
  batches_failed BIGINT,
  outcome_usable BIGINT,
  outcome_uncertain BIGINT,
  outcome_not_usable BIGINT,
  outcome_error BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT *
    FROM get_csv_builder_tool_job_progress(p_tool_job_id)
  ),
  outcomes AS (
    SELECT
      COUNT(*) FILTER (WHERE outcome_code = 'usable')::BIGINT AS outcome_usable,
      COUNT(*) FILTER (WHERE outcome_code = 'uncertain')::BIGINT AS outcome_uncertain,
      COUNT(*) FILTER (WHERE outcome_code = 'not_usable')::BIGINT AS outcome_not_usable,
      COUNT(*) FILTER (WHERE failed = true)::BIGINT AS outcome_error
    FROM csv_builder_tool_job_row_results
    WHERE tool_job_id = p_tool_job_id
  )
  SELECT
    base.rows_total,
    base.rows_completed,
    base.rows_failed,
    base.batches_total,
    base.batches_completed,
    base.batches_failed,
    outcomes.outcome_usable,
    outcomes.outcome_uncertain,
    outcomes.outcome_not_usable,
    outcomes.outcome_error
  FROM base
  CROSS JOIN outcomes;
$$;

COMMENT ON FUNCTION get_csv_builder_website_verification_tool_job_progress(UUID) IS
  'Returns aggregate progress and outcome counts for one CSV Builder website verification tool job.';

CREATE OR REPLACE FUNCTION get_csv_builder_google_ads_tool_job_progress(p_tool_job_id UUID)
RETURNS TABLE (
  rows_total BIGINT,
  rows_completed BIGINT,
  rows_failed BIGINT,
  batches_total BIGINT,
  batches_completed BIGINT,
  batches_failed BIGINT,
  outcome_yes BIGINT,
  outcome_no BIGINT,
  outcome_unknown BIGINT,
  outcome_error BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT *
    FROM get_csv_builder_tool_job_progress(p_tool_job_id)
  ),
  outcomes AS (
    SELECT
      COUNT(*) FILTER (WHERE outcome_code = 'yes')::BIGINT AS outcome_yes,
      COUNT(*) FILTER (WHERE outcome_code = 'no')::BIGINT AS outcome_no,
      COUNT(*) FILTER (WHERE outcome_code = 'unknown')::BIGINT AS outcome_unknown,
      COUNT(*) FILTER (WHERE failed = true)::BIGINT AS outcome_error
    FROM csv_builder_tool_job_row_results
    WHERE tool_job_id = p_tool_job_id
  )
  SELECT
    base.rows_total,
    base.rows_completed,
    base.rows_failed,
    base.batches_total,
    base.batches_completed,
    base.batches_failed,
    outcomes.outcome_yes,
    outcomes.outcome_no,
    outcomes.outcome_unknown,
    outcomes.outcome_error
  FROM base
  CROSS JOIN outcomes;
$$;

COMMENT ON FUNCTION get_csv_builder_google_ads_tool_job_progress(UUID) IS
  'Returns aggregate progress and outcome counts for one CSV Builder Google Ads verification tool job.';
