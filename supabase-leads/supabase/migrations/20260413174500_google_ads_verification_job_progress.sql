CREATE OR REPLACE FUNCTION get_google_ads_verification_job_progress(p_job_id UUID)
RETURNS TABLE (
  companies_processed BIGINT,
  outcome_yes BIGINT,
  outcome_no BIGINT,
  outcome_unknown BIGINT,
  outcome_error BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT AS companies_processed,
    COUNT(*) FILTER (
      WHERE (error IS NULL OR btrim(error) = '')
        AND result = 'yes'
    )::BIGINT AS outcome_yes,
    COUNT(*) FILTER (
      WHERE (error IS NULL OR btrim(error) = '')
        AND result = 'no'
    )::BIGINT AS outcome_no,
    COUNT(*) FILTER (
      WHERE (error IS NULL OR btrim(error) = '')
        AND result = 'unknown'
    )::BIGINT AS outcome_unknown,
    COUNT(*) FILTER (
      WHERE error IS NOT NULL
        AND btrim(error) <> ''
    )::BIGINT AS outcome_error
  FROM company_google_ads_verifications
  WHERE foundry_job_id = p_job_id;
$$;

COMMENT ON FUNCTION get_google_ads_verification_job_progress(UUID) IS
  'Returns aggregate Google Ads verification progress counts for one foundry job without scanning rows in application code.';
