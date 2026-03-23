-- Ingestion batches + raw source business rows + links to canonical companies.

CREATE TABLE ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT,
  ingest_version TEXT,
  parser_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_runs_status_check CHECK (
    status IN ('running', 'completed', 'failed', 'cancelled')
  )
);

CREATE INDEX idx_ingestion_runs_started_at ON ingestion_runs (started_at DESC);
CREATE INDEX idx_ingestion_runs_source_name_status ON ingestion_runs (source_name, status);

COMMENT ON TABLE ingestion_runs IS 'One row per import/API pull; tracks status, stats, and parser version.';

CREATE TABLE source_business_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id UUID NOT NULL REFERENCES ingestion_runs (id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_record_id TEXT,
  name_raw TEXT NOT NULL,
  website TEXT,
  phone TEXT,
  address_raw TEXT,
  line1 TEXT,
  line2 TEXT,
  city TEXT,
  state_region TEXT,
  postal_code TEXT,
  country TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_business_records_ingestion_run
  ON source_business_records (ingestion_run_id);
CREATE INDEX idx_source_business_records_source_record
  ON source_business_records (source_name, source_record_id)
  WHERE source_record_id IS NOT NULL;

COMMENT ON TABLE source_business_records IS 'Raw inbound business rows from geo/listing/scrape sources before canonical resolution.';

CREATE TABLE source_business_company_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_business_record_id UUID NOT NULL REFERENCES source_business_records (id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  link_status TEXT NOT NULL,
  link_score NUMERIC(7, 4),
  linker_version TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_business_company_links_record
  ON source_business_company_links (source_business_record_id);
CREATE INDEX idx_source_business_company_links_company
  ON source_business_company_links (company_id);
CREATE INDEX idx_source_business_company_links_current
  ON source_business_company_links (source_business_record_id, is_current);

CREATE UNIQUE INDEX uniq_source_business_company_links_current_pair
  ON source_business_company_links (source_business_record_id, company_id)
  WHERE is_current = true;

COMMENT ON TABLE source_business_company_links IS 'Links raw source rows to canonical companies; supports adjudication and re-linking.';

-- ---------------------------------------------------------------------------
-- Link row history (adjudication changes)
-- ---------------------------------------------------------------------------

CREATE TABLE source_business_company_link_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_business_company_link_id UUID NOT NULL REFERENCES source_business_company_links (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,
  change_reason TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE (source_business_company_link_id, version_number)
);

CREATE INDEX idx_source_business_company_link_history_link
  ON source_business_company_link_history (source_business_company_link_id, version_number DESC);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_ingestion_runs_updated_at
  BEFORE UPDATE ON ingestion_runs
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TRIGGER trg_source_business_records_updated_at
  BEFORE UPDATE ON source_business_records
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TRIGGER trg_source_business_company_links_updated_at
  BEFORE UPDATE ON source_business_company_links
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE archive for source_business_company_links
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_archive_source_business_company_link_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM source_business_company_link_history
  WHERE source_business_company_link_id = OLD.id;

  INSERT INTO source_business_company_link_history (
    source_business_company_link_id,
    version_number,
    changed_at,
    snapshot
  )
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'source_business_record_id', OLD.source_business_record_id,
      'company_id', OLD.company_id,
      'link_status', OLD.link_status,
      'link_score', OLD.link_score,
      'linker_version', OLD.linker_version,
      'is_current', OLD.is_current,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_source_business_company_links_archive_history
  BEFORE UPDATE ON source_business_company_links
  FOR EACH ROW
  EXECUTE FUNCTION trg_archive_source_business_company_link_history();

-- ---------------------------------------------------------------------------
-- RLS: enabled, no policies (service_role only)
-- ---------------------------------------------------------------------------

ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_business_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_business_company_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_business_company_link_history ENABLE ROW LEVEL SECURITY;
