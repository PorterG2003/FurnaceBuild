ALTER TABLE foundry_jobs
  DROP CONSTRAINT foundry_jobs_job_type_check;

ALTER TABLE foundry_jobs
  ADD CONSTRAINT foundry_jobs_job_type_check CHECK (
    job_type IN (
      'normalize_ingestion_run',
      'bulk_source_resolution',
      'state_matching_batch',
      'autolink_ingestion_run',
      'contact_enrichment_import_run',
      'website_verification_import_run',
      'google_ads_verification_import_run'
    )
  );

CREATE TABLE company_google_ads_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  website_verification_id UUID REFERENCES company_website_verifications(id) ON DELETE SET NULL,
  foundry_job_id UUID REFERENCES foundry_jobs(id) ON DELETE SET NULL,
  source_ingestion_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  input_url TEXT NOT NULL,
  search_domain TEXT NOT NULL,
  result TEXT,
  matched_advertiser_id TEXT,
  matched_advertiser_name TEXT,
  advertiser_url TEXT,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  verifier_version TEXT NOT NULL,
  lookup_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_google_ads_verifications_result_check CHECK (
    result IS NULL OR result IN ('yes', 'no', 'unknown')
  )
);

CREATE INDEX idx_company_google_ads_verifications_company_verified
  ON company_google_ads_verifications (company_id, verified_at DESC);

CREATE INDEX idx_company_google_ads_verifications_job
  ON company_google_ads_verifications (foundry_job_id);

CREATE INDEX idx_company_google_ads_verifications_run
  ON company_google_ads_verifications (source_ingestion_run_id);

CREATE INDEX idx_company_google_ads_verifications_website_verification
  ON company_google_ads_verifications (website_verification_id);

COMMENT ON TABLE company_google_ads_verifications IS
  'Durable append-only Google Ads verification attempts per company, sourced from the latest usable website verification.';

COMMENT ON COLUMN company_google_ads_verifications.signals IS
  'Explainability JSON with matched advertiser details, suggestion evidence, page text, and diagnostic metadata.';

COMMENT ON COLUMN company_google_ads_verifications.lookup_stats IS
  'Browser automation summary JSON such as timings, request counts, response parsing details, and navigation diagnostics.';

CREATE TRIGGER trg_company_google_ads_verifications_updated_at
  BEFORE UPDATE ON company_google_ads_verifications
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

ALTER TABLE company_google_ads_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON company_google_ads_verifications FROM anon, authenticated;
