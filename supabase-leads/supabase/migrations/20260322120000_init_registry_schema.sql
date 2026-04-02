-- Registry / company intel database (separate Supabase project).
-- Layers: (1) current best-known rows, (2) immutable source snapshots + row history,
-- (3) simple views for current slices. Access via service role from a backend API only.
--
-- History strategy (v1): BEFORE UPDATE triggers copy the full prior row into *_history.
-- entity_owners: prefer append + close (new row is_current=true, old row updated is_current=false);
-- updates still archive the pre-update row to entity_owner_history.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Layer 2 (evidence): raw registry pulls — append-only by convention
-- ---------------------------------------------------------------------------

CREATE TABLE registry_source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  state TEXT NOT NULL,
  lookup_key TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  parsed_successfully BOOLEAN NOT NULL DEFAULT false,
  parser_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_registry_source_snapshots_lookup
  ON registry_source_snapshots (source_type, state, lookup_key);
CREATE INDEX idx_registry_source_snapshots_retrieved_at
  ON registry_source_snapshots (retrieved_at DESC);

COMMENT ON TABLE registry_source_snapshots IS 'Immutable evidence of each source pull; enables re-parsing and audit.';

-- ---------------------------------------------------------------------------
-- Layer 1: canonical current records
-- ---------------------------------------------------------------------------

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  normalized_key TEXT UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_legal_name ON companies (legal_name);

CREATE TABLE company_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  line1 TEXT,
  line2 TEXT,
  city TEXT,
  state_region TEXT,
  postal_code TEXT,
  country TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_locations_company_id ON company_locations (company_id);
CREATE INDEX idx_company_locations_state_region ON company_locations (state_region);

CREATE TABLE state_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_snapshot_id UUID REFERENCES registry_source_snapshots (id) ON DELETE SET NULL,
  state TEXT NOT NULL,
  registry_entity_id TEXT,
  legal_name TEXT,
  entity_status TEXT,
  raw_parsed JSONB,
  parser_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_state_entities_snapshot ON state_entities (source_snapshot_id);
CREATE INDEX idx_state_entities_state_registry ON state_entities (state, registry_entity_id);

CREATE TABLE entity_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_entity_id UUID NOT NULL REFERENCES state_entities (id) ON DELETE CASCADE,
  source_snapshot_id UUID REFERENCES registry_source_snapshots (id) ON DELETE SET NULL,
  owner_name TEXT NOT NULL,
  title_role TEXT,
  effective_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entity_owners_entity_current ON entity_owners (state_entity_id, is_current);
CREATE INDEX idx_entity_owners_snapshot ON entity_owners (source_snapshot_id);

CREATE TABLE company_entity_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  state_entity_id UUID NOT NULL REFERENCES state_entities (id) ON DELETE CASCADE,
  match_score NUMERIC(7, 4),
  match_status TEXT NOT NULL,
  matcher_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_entity_matches_status_check CHECK (
    match_status IN ('candidate', 'promoted', 'rejected')
  )
);

CREATE INDEX idx_company_entity_matches_company ON company_entity_matches (company_id);
CREATE INDEX idx_company_entity_matches_entity ON company_entity_matches (state_entity_id);
CREATE INDEX idx_company_entity_matches_current ON company_entity_matches (company_id, is_current);

CREATE TABLE reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  matcher_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT reconciliation_runs_status_check CHECK (
    status IN ('running', 'completed', 'failed')
  )
);

CREATE INDEX idx_reconciliation_runs_started_at ON reconciliation_runs (started_at DESC);

CREATE TABLE reconciliation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_runs (id) ON DELETE CASCADE,
  company_entity_match_id UUID REFERENCES company_entity_matches (id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
  outcome TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  matcher_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reconciliation_results_run ON reconciliation_results (reconciliation_run_id);
CREATE INDEX idx_reconciliation_results_company ON reconciliation_results (company_id);

-- ---------------------------------------------------------------------------
-- Layer 2: row snapshot history (full prior row as JSONB)
-- changed_by is a UUID from the main app auth user (no FK — different database).
-- ---------------------------------------------------------------------------

CREATE TABLE company_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,
  change_reason TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE (company_id, version_number)
);

CREATE INDEX idx_company_history_company ON company_history (company_id, version_number DESC);

CREATE TABLE company_location_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_location_id UUID NOT NULL REFERENCES company_locations (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,
  change_reason TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE (company_location_id, version_number)
);

CREATE INDEX idx_company_location_history_loc ON company_location_history (company_location_id, version_number DESC);

CREATE TABLE state_entity_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_entity_id UUID NOT NULL REFERENCES state_entities (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,
  change_reason TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE (state_entity_id, version_number)
);

CREATE INDEX idx_state_entity_history_entity ON state_entity_history (state_entity_id, version_number DESC);

CREATE TABLE entity_owner_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_owner_id UUID NOT NULL REFERENCES entity_owners (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,
  change_reason TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE (entity_owner_id, version_number)
);

CREATE INDEX idx_entity_owner_history_owner ON entity_owner_history (entity_owner_id, version_number DESC);

CREATE TABLE company_entity_match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_entity_match_id UUID NOT NULL REFERENCES company_entity_matches (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,
  change_reason TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE (company_entity_match_id, version_number)
);

CREATE INDEX idx_company_entity_match_history_match
  ON company_entity_match_history (company_entity_match_id, version_number DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION registry_update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TRIGGER trg_company_locations_updated_at
  BEFORE UPDATE ON company_locations
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TRIGGER trg_state_entities_updated_at
  BEFORE UPDATE ON state_entities
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TRIGGER trg_entity_owners_updated_at
  BEFORE UPDATE ON entity_owners
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

CREATE TRIGGER trg_company_entity_matches_updated_at
  BEFORE UPDATE ON company_entity_matches
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: archive previous row to *_history (Option A, v1)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_archive_company_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM company_history
  WHERE company_id = OLD.id;

  INSERT INTO company_history (company_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'legal_name', OLD.legal_name,
      'normalized_key', OLD.normalized_key,
      'notes', OLD.notes,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_archive_history
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION trg_archive_company_history();

CREATE OR REPLACE FUNCTION trg_archive_company_location_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM company_location_history
  WHERE company_location_id = OLD.id;

  INSERT INTO company_location_history (company_location_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'company_id', OLD.company_id,
      'line1', OLD.line1,
      'line2', OLD.line2,
      'city', OLD.city,
      'state_region', OLD.state_region,
      'postal_code', OLD.postal_code,
      'country', OLD.country,
      'is_primary', OLD.is_primary,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_locations_archive_history
  BEFORE UPDATE ON company_locations
  FOR EACH ROW
  EXECUTE FUNCTION trg_archive_company_location_history();

CREATE OR REPLACE FUNCTION trg_archive_state_entity_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM state_entity_history
  WHERE state_entity_id = OLD.id;

  INSERT INTO state_entity_history (state_entity_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'source_snapshot_id', OLD.source_snapshot_id,
      'state', OLD.state,
      'registry_entity_id', OLD.registry_entity_id,
      'legal_name', OLD.legal_name,
      'entity_status', OLD.entity_status,
      'raw_parsed', OLD.raw_parsed,
      'parser_version', OLD.parser_version,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_state_entities_archive_history
  BEFORE UPDATE ON state_entities
  FOR EACH ROW
  EXECUTE FUNCTION trg_archive_state_entity_history();

CREATE OR REPLACE FUNCTION trg_archive_entity_owner_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM entity_owner_history
  WHERE entity_owner_id = OLD.id;

  INSERT INTO entity_owner_history (entity_owner_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'state_entity_id', OLD.state_entity_id,
      'source_snapshot_id', OLD.source_snapshot_id,
      'owner_name', OLD.owner_name,
      'title_role', OLD.title_role,
      'effective_at', OLD.effective_at,
      'ended_at', OLD.ended_at,
      'observed_at', OLD.observed_at,
      'is_current', OLD.is_current,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entity_owners_archive_history
  BEFORE UPDATE ON entity_owners
  FOR EACH ROW
  EXECUTE FUNCTION trg_archive_entity_owner_history();

CREATE OR REPLACE FUNCTION trg_archive_company_entity_match_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM company_entity_match_history
  WHERE company_entity_match_id = OLD.id;

  INSERT INTO company_entity_match_history (company_entity_match_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'company_id', OLD.company_id,
      'state_entity_id', OLD.state_entity_id,
      'match_score', OLD.match_score,
      'match_status', OLD.match_status,
      'matcher_version', OLD.matcher_version,
      'scoring_version', OLD.scoring_version,
      'ruleset_version', OLD.ruleset_version,
      'is_current', OLD.is_current,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_entity_matches_archive_history
  BEFORE UPDATE ON company_entity_matches
  FOR EACH ROW
  EXECUTE FUNCTION trg_archive_company_entity_match_history();

-- ---------------------------------------------------------------------------
-- Layer 3: derived views (current slices)
-- ---------------------------------------------------------------------------

CREATE VIEW current_entity_owners AS
SELECT *
FROM entity_owners
WHERE is_current = true;

CREATE VIEW current_company_entity_matches AS
SELECT *
FROM company_entity_matches
WHERE is_current = true;

COMMENT ON VIEW current_entity_owners IS 'Owners with is_current = true; prefer append+close updates on entity_owners.';
COMMENT ON VIEW current_company_entity_matches IS 'Match rows with is_current = true.';

-- ---------------------------------------------------------------------------
-- RLS: enabled, no policies — PostgREST anon/authenticated have no access;
-- service_role bypasses RLS for backend/API usage.
-- ---------------------------------------------------------------------------

ALTER TABLE registry_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_entity_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_entity_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_owner_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_entity_match_history ENABLE ROW LEVEL SECURITY;
