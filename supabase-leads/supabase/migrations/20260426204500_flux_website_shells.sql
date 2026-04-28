ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS shell_domain_key TEXT,
  ADD COLUMN IF NOT EXISTS is_flux_domain_shell BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_shell_domain_key_unique
  ON companies (shell_domain_key)
  WHERE shell_domain_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_website_crawls_domain_crawled_success
  ON company_website_crawls (normalized_domain_key, crawled_at DESC)
  WHERE error IS NULL;

CREATE TABLE IF NOT EXISTS flux_company_website_sources (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  input_url TEXT NOT NULL,
  normalized_domain_key TEXT NOT NULL,
  created_by UUID,
  last_scrape_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flux_company_website_sources_domain
  ON flux_company_website_sources (normalized_domain_key);

CREATE TRIGGER trg_flux_company_website_sources_updated_at
  BEFORE UPDATE ON flux_company_website_sources
  FOR EACH ROW
  EXECUTE FUNCTION registry_update_updated_at_column();

COMMENT ON COLUMN companies.shell_domain_key IS
  'Normalized domain key used only for Flux website shell companies.';

COMMENT ON COLUMN companies.is_flux_domain_shell IS
  'True when the company row exists only to anchor Flux website intelligence artifacts.';

COMMENT ON TABLE flux_company_website_sources IS
  'Canonical website seed URL for Flux-created shell companies used by website verification jobs.';
