WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY foundry_job_id, company_id
      ORDER BY verified_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM company_website_verifications
  WHERE foundry_job_id IS NOT NULL
)
DELETE FROM company_website_verifications
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_website_verifications_job_company_key'
  ) THEN
    ALTER TABLE company_website_verifications
      ADD CONSTRAINT company_website_verifications_job_company_key
      UNIQUE (foundry_job_id, company_id);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION get_website_verification_job_progress(p_job_id UUID)
RETURNS TABLE (
  companies_processed BIGINT,
  outcome_usable BIGINT,
  outcome_uncertain BIGINT,
  outcome_not_usable BIGINT,
  outcome_error BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT AS companies_processed,
    COUNT(*) FILTER (WHERE band = 'usable')::BIGINT AS outcome_usable,
    COUNT(*) FILTER (WHERE band = 'uncertain')::BIGINT AS outcome_uncertain,
    COUNT(*) FILTER (WHERE band = 'not_usable')::BIGINT AS outcome_not_usable,
    COUNT(*) FILTER (WHERE error IS NOT NULL AND btrim(error) <> '')::BIGINT AS outcome_error
  FROM company_website_verifications
  WHERE foundry_job_id = p_job_id;
$$;

COMMENT ON FUNCTION get_website_verification_job_progress(UUID) IS
  'Returns aggregate website verification progress counts for one foundry job without scanning rows in application code.';
