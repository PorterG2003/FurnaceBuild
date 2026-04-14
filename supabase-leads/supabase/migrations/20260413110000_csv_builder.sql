-- CSV Builder: one-off enrichment workspaces stored separately from ingestion runs.

CREATE TABLE csv_builder_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  created_by UUID,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source_file_name TEXT NOT NULL,
  source_file_size_bytes BIGINT,
  source_file_mime_type TEXT,
  source_row_count INTEGER NOT NULL DEFAULT 0,
  source_column_count INTEGER NOT NULL DEFAULT 0,
  visible_column_count INTEGER NOT NULL DEFAULT 0,
  last_exported_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csv_builder_runs_status_check CHECK (
    status IN ('draft', 'ready', 'running', 'errored', 'archived')
  ),
  CONSTRAINT csv_builder_runs_source_row_count_check CHECK (source_row_count >= 0),
  CONSTRAINT csv_builder_runs_source_column_count_check CHECK (source_column_count >= 0),
  CONSTRAINT csv_builder_runs_visible_column_count_check CHECK (visible_column_count >= 0),
  CONSTRAINT csv_builder_runs_source_file_size_bytes_check CHECK (
    source_file_size_bytes IS NULL OR source_file_size_bytes >= 0
  )
);

CREATE INDEX idx_csv_builder_runs_account_created_at
  ON csv_builder_runs (account_id, created_at DESC);
CREATE INDEX idx_csv_builder_runs_account_last_activity
  ON csv_builder_runs (account_id, last_activity_at DESC);
CREATE INDEX idx_csv_builder_runs_account_status_created_at
  ON csv_builder_runs (account_id, status, created_at DESC);

CREATE TRIGGER trg_csv_builder_runs_updated_at
  BEFORE UPDATE ON csv_builder_runs
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TABLE csv_builder_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES csv_builder_runs(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_type TEXT NOT NULL,
  position INTEGER NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  tool_type TEXT,
  tool_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_column_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  status TEXT NOT NULL DEFAULT 'ready',
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csv_builder_columns_kind_check CHECK (
    kind IN ('source', 'tool_output', 'system')
  ),
  CONSTRAINT csv_builder_columns_data_type_check CHECK (
    data_type IN ('text', 'number', 'boolean', 'date', 'datetime', 'json')
  ),
  CONSTRAINT csv_builder_columns_status_check CHECK (
    status IN ('ready', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled')
  ),
  CONSTRAINT csv_builder_columns_position_check CHECK (position >= 0),
  CONSTRAINT csv_builder_columns_key_format_check CHECK (key ~ '^c[0-9]{3,}$')
);

CREATE UNIQUE INDEX uniq_csv_builder_columns_run_key
  ON csv_builder_columns (run_id, key);
CREATE UNIQUE INDEX uniq_csv_builder_columns_run_position
  ON csv_builder_columns (run_id, position);
CREATE INDEX idx_csv_builder_columns_run_visible_position
  ON csv_builder_columns (run_id, visible, position);
CREATE INDEX idx_csv_builder_columns_run_kind_position
  ON csv_builder_columns (run_id, kind, position);
CREATE INDEX idx_csv_builder_columns_run_tool_type
  ON csv_builder_columns (run_id, tool_type);

CREATE TRIGGER trg_csv_builder_columns_updated_at
  BEFORE UPDATE ON csv_builder_columns
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TABLE csv_builder_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES csv_builder_runs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  source_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csv_builder_rows_row_number_check CHECK (row_number >= 1),
  CONSTRAINT csv_builder_rows_row_status_check CHECK (
    row_status IN ('ready', 'partial', 'errored')
  ),
  CONSTRAINT csv_builder_rows_source_values_object_check CHECK (jsonb_typeof(source_values) = 'object'),
  CONSTRAINT csv_builder_rows_tool_values_object_check CHECK (jsonb_typeof(tool_values) = 'object')
);

CREATE UNIQUE INDEX uniq_csv_builder_rows_run_row_number
  ON csv_builder_rows (run_id, row_number);
CREATE INDEX idx_csv_builder_rows_run_row_number
  ON csv_builder_rows (run_id, row_number);
CREATE INDEX idx_csv_builder_rows_run_id
  ON csv_builder_rows (run_id, id);

CREATE TRIGGER trg_csv_builder_rows_updated_at
  BEFORE UPDATE ON csv_builder_rows
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TABLE csv_builder_column_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES csv_builder_runs(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES csv_builder_columns(id) ON DELETE CASCADE,
  foundry_job_id UUID REFERENCES foundry_jobs(id) ON DELETE SET NULL,
  tool_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_column_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  status TEXT NOT NULL,
  rows_total INTEGER,
  rows_completed INTEGER,
  rows_failed INTEGER,
  error_summary TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csv_builder_column_jobs_mode_check CHECK (
    mode IN ('create_column', 'rerun_column')
  ),
  CONSTRAINT csv_builder_column_jobs_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')
  ),
  CONSTRAINT csv_builder_column_jobs_rows_total_check CHECK (rows_total IS NULL OR rows_total >= 0),
  CONSTRAINT csv_builder_column_jobs_rows_completed_check CHECK (rows_completed IS NULL OR rows_completed >= 0),
  CONSTRAINT csv_builder_column_jobs_rows_failed_check CHECK (rows_failed IS NULL OR rows_failed >= 0)
);

CREATE INDEX idx_csv_builder_column_jobs_run_created_at
  ON csv_builder_column_jobs (run_id, created_at DESC);
CREATE INDEX idx_csv_builder_column_jobs_column_created_at
  ON csv_builder_column_jobs (column_id, created_at DESC);
CREATE INDEX idx_csv_builder_column_jobs_foundry_job_id
  ON csv_builder_column_jobs (foundry_job_id);
CREATE INDEX idx_csv_builder_column_jobs_run_status_created_at
  ON csv_builder_column_jobs (run_id, status, created_at DESC);

ALTER TABLE csv_builder_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_builder_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_builder_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_builder_column_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON csv_builder_runs FROM anon, authenticated;
REVOKE ALL ON csv_builder_columns FROM anon, authenticated;
REVOKE ALL ON csv_builder_rows FROM anon, authenticated;
REVOKE ALL ON csv_builder_column_jobs FROM anon, authenticated;

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
      'csv_builder_export'
    )
  );
