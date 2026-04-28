CREATE TABLE company_website_crawls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  foundry_job_id UUID REFERENCES foundry_jobs(id) ON DELETE SET NULL,
  source_ingestion_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  input_url TEXT NOT NULL,
  final_url TEXT,
  normalized_domain_key TEXT,
  crawl_version TEXT NOT NULL,
  max_depth SMALLINT NOT NULL,
  max_pages SMALLINT NOT NULL,
  pages_visited SMALLINT NOT NULL DEFAULT 0,
  max_depth_reached SMALLINT NOT NULL DEFAULT 0,
  failed_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  parked BOOLEAN NOT NULL DEFAULT false,
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  site_assets JSONB NOT NULL DEFAULT '{}'::jsonb,
  elapsed_ms INTEGER,
  error TEXT,
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_website_crawls_depth_check CHECK (max_depth >= 0),
  CONSTRAINT company_website_crawls_max_pages_check CHECK (max_pages > 0),
  CONSTRAINT company_website_crawls_pages_visited_check CHECK (pages_visited >= 0),
  CONSTRAINT company_website_crawls_max_depth_reached_check CHECK (max_depth_reached >= 0),
  CONSTRAINT company_website_crawls_elapsed_ms_check CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  CONSTRAINT company_website_crawls_job_company_key UNIQUE (foundry_job_id, company_id)
);

CREATE INDEX idx_company_website_crawls_company_crawled
  ON company_website_crawls (company_id, crawled_at DESC);

CREATE INDEX idx_company_website_crawls_job
  ON company_website_crawls (foundry_job_id);

CREATE INDEX idx_company_website_crawls_run
  ON company_website_crawls (source_ingestion_run_id);

COMMENT ON TABLE company_website_crawls IS
  'Foundry website crawl artifacts produced by the website intelligence/verification worker.';

COMMENT ON COLUMN company_website_crawls.pages IS
  'Bounded, cleaned per-page crawl records. Contains scraped business text and should not be exposed directly to clients by table policy.';

COMMENT ON COLUMN company_website_crawls.site_assets IS
  'Deterministic site-level assets and contact evidence such as logo candidates, colors, organization names, social profiles, phones, emails, and addresses.';

ALTER TABLE company_website_crawls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON company_website_crawls FROM anon, authenticated;

CREATE TRIGGER trg_company_website_crawls_updated_at
  BEFORE UPDATE ON company_website_crawls
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

ALTER TABLE company_website_verifications
  ADD COLUMN website_crawl_id UUID REFERENCES company_website_crawls(id) ON DELETE SET NULL;

CREATE INDEX idx_company_website_verifications_crawl
  ON company_website_verifications (website_crawl_id);

COMMENT ON COLUMN company_website_verifications.website_crawl_id IS
  'Reusable Foundry crawl artifact used to derive this verification row.';

CREATE TABLE company_website_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  website_crawl_id UUID REFERENCES company_website_crawls(id) ON DELETE SET NULL,
  foundry_job_id UUID REFERENCES foundry_jobs(id) ON DELETE SET NULL,
  source_ingestion_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  input_hash TEXT NOT NULL,
  brief_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_provider TEXT NOT NULL DEFAULT 'openrouter',
  model TEXT NOT NULL,
  llm_status TEXT NOT NULL DEFAULT 'not_run',
  site_brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  llm_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_website_intelligence_status_check CHECK (
    llm_status IN ('not_run', 'completed', 'failed', 'skipped')
  ),
  CONSTRAINT company_website_intelligence_job_model_key UNIQUE (
    website_crawl_id,
    brief_version,
    prompt_version,
    model_provider,
    model
  )
);

CREATE INDEX idx_company_website_intelligence_company_generated
  ON company_website_intelligence (company_id, generated_at DESC NULLS LAST, created_at DESC);

CREATE INDEX idx_company_website_intelligence_crawl
  ON company_website_intelligence (website_crawl_id);

CREATE INDEX idx_company_website_intelligence_job
  ON company_website_intelligence (foundry_job_id);

COMMENT ON TABLE company_website_intelligence IS
  'Foundry website intelligence summaries derived from bounded crawl artifacts and compact LLM briefs.';

COMMENT ON COLUMN company_website_intelligence.site_brief IS
  'Compact deterministic payload sent to the LLM. May include short snippets of scraped business text.';

COMMENT ON COLUMN company_website_intelligence.extracted_profile IS
  'Strict structured profile returned by the LLM or an empty object when the LLM did not complete.';

ALTER TABLE company_website_intelligence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON company_website_intelligence FROM anon, authenticated;

CREATE TRIGGER trg_company_website_intelligence_updated_at
  BEFORE UPDATE ON company_website_intelligence
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();
