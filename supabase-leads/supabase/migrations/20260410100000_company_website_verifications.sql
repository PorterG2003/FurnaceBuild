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
      'website_verification_import_run'
    )
  );

CREATE TABLE company_website_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  foundry_job_id UUID REFERENCES foundry_jobs(id) ON DELETE SET NULL,
  source_ingestion_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  input_url TEXT NOT NULL,
  final_url TEXT,
  score SMALLINT,
  band TEXT,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  verifier_version TEXT NOT NULL,
  crawl_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_website_verifications_band_check CHECK (
    band IS NULL OR band IN ('usable', 'uncertain', 'not_usable')
  ),
  CONSTRAINT company_website_verifications_score_check CHECK (
    score IS NULL OR (score >= 0 AND score <= 100)
  )
);

CREATE INDEX idx_company_website_verifications_company_verified
  ON company_website_verifications (company_id, verified_at DESC);

CREATE INDEX idx_company_website_verifications_job
  ON company_website_verifications (foundry_job_id);

CREATE INDEX idx_company_website_verifications_run
  ON company_website_verifications (source_ingestion_run_id);

COMMENT ON TABLE company_website_verifications IS
  'Durable append-only website verification attempts per company, including crawl-derived signals and scoring.';

COMMENT ON COLUMN company_website_verifications.signals IS
  'Explainability JSON: per-dimension sub-scores, vetoes, page summaries, and supporting evidence.';

COMMENT ON COLUMN company_website_verifications.crawl_stats IS
  'Crawler summary JSON such as pages visited, failed URLs, and max depth reached.';

CREATE TRIGGER trg_company_website_verifications_updated_at
  BEFORE UPDATE ON company_website_verifications
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

ALTER TABLE company_website_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON company_website_verifications FROM anon, authenticated;
