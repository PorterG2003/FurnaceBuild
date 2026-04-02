ALTER TABLE foundry_jobs
  DROP CONSTRAINT foundry_jobs_job_type_check;

ALTER TABLE foundry_jobs
  ADD CONSTRAINT foundry_jobs_job_type_check CHECK (
    job_type IN (
      'normalize_ingestion_run',
      'bulk_source_resolution',
      'state_matching_batch',
      'autolink_ingestion_run',
      'contact_enrichment_import_run'
    )
  );

CREATE TABLE contact_enrichment_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  lookup_type TEXT NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_owner_id UUID REFERENCES entity_owners(id) ON DELETE SET NULL,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_enrichment_suppressions_provider_check CHECK (provider IN ('skipsherpa')),
  CONSTRAINT contact_enrichment_suppressions_lookup_type_check CHECK (lookup_type IN ('person'))
);

CREATE UNIQUE INDEX uniq_contact_enrichment_suppressions_target
  ON contact_enrichment_suppressions (provider, lookup_type, company_id, entity_owner_id);

ALTER TABLE contact_enrichment_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_suppressions FROM anon, authenticated;

CREATE TABLE contact_enrichment_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  foundry_job_id UUID NOT NULL REFERENCES foundry_jobs(id) ON DELETE CASCADE,
  ingestion_run_id UUID NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_owner_id UUID REFERENCES entity_owners(id) ON DELETE SET NULL,
  owner_name TEXT NOT NULL,
  owner_title_role TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  address_line_1 TEXT NOT NULL,
  address_line_2 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal_code TEXT,
  address_country TEXT,
  lookup_fingerprint TEXT NOT NULL,
  latest_source_observed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  skip_reason TEXT,
  last_attempt_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_enrichment_targets_status_check CHECK (
    status IN (
      'pending',
      'running',
      'accepted',
      'ambiguous',
      'no_match',
      'error',
      'skipped_recent',
      'skipped_suppressed'
    )
  )
);

CREATE UNIQUE INDEX uniq_contact_enrichment_targets_job_fingerprint
  ON contact_enrichment_targets (foundry_job_id, lookup_fingerprint);

CREATE INDEX idx_contact_enrichment_targets_job_status
  ON contact_enrichment_targets (foundry_job_id, status, id);

CREATE INDEX idx_contact_enrichment_targets_run_company
  ON contact_enrichment_targets (ingestion_run_id, company_id, id);

CREATE TRIGGER trg_contact_enrichment_targets_updated_at
  BEFORE UPDATE ON contact_enrichment_targets
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

ALTER TABLE contact_enrichment_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_targets FROM anon, authenticated;

CREATE TABLE contact_enrichment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  foundry_job_id UUID NOT NULL REFERENCES foundry_jobs(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES contact_enrichment_targets(id) ON DELETE CASCADE,
  ingestion_run_id UUID NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  lookup_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_owner_id UUID REFERENCES entity_owners(id) ON DELETE SET NULL,
  lookup_fingerprint TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  http_status INTEGER,
  provider_status_code INTEGER,
  expected_results INTEGER,
  classification TEXT NOT NULL DEFAULT 'error',
  is_billable_candidate BOOLEAN NOT NULL DEFAULT false,
  error_summary TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_enrichment_attempts_provider_check CHECK (provider IN ('skipsherpa')),
  CONSTRAINT contact_enrichment_attempts_lookup_type_check CHECK (lookup_type IN ('person')),
  CONSTRAINT contact_enrichment_attempts_classification_check CHECK (
    classification IN ('accepted_strong_match', 'ambiguous', 'no_match', 'error')
  )
);

CREATE INDEX idx_contact_enrichment_attempts_fingerprint_time
  ON contact_enrichment_attempts (provider, lookup_fingerprint, performed_at DESC);

CREATE INDEX idx_contact_enrichment_attempts_run_time
  ON contact_enrichment_attempts (ingestion_run_id, performed_at DESC);

CREATE INDEX idx_contact_enrichment_attempts_company_time
  ON contact_enrichment_attempts (company_id, performed_at DESC);

ALTER TABLE contact_enrichment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_attempts FROM anon, authenticated;

ALTER TABLE contact_enrichment_targets
  ADD CONSTRAINT contact_enrichment_targets_last_attempt_fk
  FOREIGN KEY (last_attempt_id) REFERENCES contact_enrichment_attempts(id) ON DELETE SET NULL;

CREATE TABLE contact_enrichment_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES contact_enrichment_attempts(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES contact_enrichment_targets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_owner_id UUID REFERENCES entity_owners(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  lookup_type TEXT NOT NULL,
  provider_object_id TEXT,
  provider_source_object_id TEXT,
  provider_source_id TEXT,
  selected_rank INTEGER NOT NULL DEFAULT 1,
  matched_name TEXT NOT NULL,
  matched_first_name TEXT,
  matched_middle_name TEXT,
  matched_last_name TEXT,
  matched_suffix TEXT,
  age INTEGER,
  date_of_birth_month_year TEXT,
  deceased BOOLEAN,
  bankruptcy BOOLEAN,
  debt_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  email_count INTEGER NOT NULL DEFAULT 0,
  phone_count INTEGER NOT NULL DEFAULT 0,
  address_count INTEGER NOT NULL DEFAULT 0,
  employer_count INTEGER NOT NULL DEFAULT 0,
  relative_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_enrichment_matches_provider_check CHECK (provider IN ('skipsherpa')),
  CONSTRAINT contact_enrichment_matches_lookup_type_check CHECK (lookup_type IN ('person'))
);

CREATE UNIQUE INDEX uniq_contact_enrichment_matches_attempt
  ON contact_enrichment_matches (attempt_id);

CREATE INDEX idx_contact_enrichment_matches_company_created
  ON contact_enrichment_matches (company_id, created_at DESC);

CREATE INDEX idx_contact_enrichment_matches_entity_owner_created
  ON contact_enrichment_matches (entity_owner_id, created_at DESC);

CREATE TRIGGER trg_contact_enrichment_matches_updated_at
  BEFORE UPDATE ON contact_enrichment_matches
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

ALTER TABLE contact_enrichment_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_matches FROM anon, authenticated;

CREATE TABLE contact_enrichment_match_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES contact_enrichment_matches(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  raw_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_contact_enrichment_match_emails_value
  ON contact_enrichment_match_emails (match_id, email_address);

ALTER TABLE contact_enrichment_match_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_match_emails FROM anon, authenticated;

CREATE TABLE contact_enrichment_match_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES contact_enrichment_matches(id) ON DELETE CASCADE,
  e164_format TEXT,
  local_format TEXT,
  phone_type TEXT,
  carrier TEXT,
  country_code TEXT,
  country_calling_code INTEGER,
  last_seen DATE,
  is_dnc BOOLEAN,
  dnc_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_enrichment_match_phones_match_rank
  ON contact_enrichment_match_phones (match_id, raw_rank, id);

ALTER TABLE contact_enrichment_match_phones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_match_phones FROM anon, authenticated;

CREATE TABLE contact_enrichment_match_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES contact_enrichment_matches(id) ON DELETE CASCADE,
  provider_object_id TEXT,
  provider_source_object_id TEXT,
  provider_source_id TEXT,
  delivery_line1 TEXT,
  delivery_line2 TEXT,
  last_line TEXT,
  country_code TEXT,
  is_verified_deliverable BOOLEAN,
  street TEXT,
  city TEXT,
  state TEXT,
  zipcode TEXT,
  county_name TEXT,
  fips TEXT,
  is_vacant BOOLEAN,
  attom_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_enrichment_match_addresses_match_rank
  ON contact_enrichment_match_addresses (match_id, raw_rank, id);

ALTER TABLE contact_enrichment_match_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_match_addresses FROM anon, authenticated;

CREATE TABLE contact_enrichment_match_employers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES contact_enrichment_matches(id) ON DELETE CASCADE,
  employer_name TEXT NOT NULL,
  employer_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_enrichment_match_employers_match_rank
  ON contact_enrichment_match_employers (match_id, raw_rank, id);

ALTER TABLE contact_enrichment_match_employers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_match_employers FROM anon, authenticated;

CREATE TABLE contact_enrichment_match_relatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES contact_enrichment_matches(id) ON DELETE CASCADE,
  relative_name TEXT NOT NULL,
  relation_type TEXT,
  age INTEGER,
  deceased BOOLEAN,
  date_of_birth_month_year TEXT,
  person_name JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_enrichment_match_relatives_match_rank
  ON contact_enrichment_match_relatives (match_id, raw_rank, id);

ALTER TABLE contact_enrichment_match_relatives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_enrichment_match_relatives FROM anon, authenticated;

COMMENT ON TABLE contact_enrichment_targets IS
  'Manual import-run contact enrichment targets snapshot. Created at job start to stabilize batching, freshness checks, and operator preview counts.';

COMMENT ON TABLE contact_enrichment_attempts IS
  'Raw provider request/response evidence for manual contact enrichment lookups, keyed by stable same-source lookup fingerprints.';

COMMENT ON TABLE contact_enrichment_matches IS
  'Accepted strong person matches extracted from contact enrichment attempts; child tables hold queryable phones, emails, addresses, employers, and relatives.';
