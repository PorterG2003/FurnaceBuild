CREATE OR REPLACE FUNCTION get_reconciliation_outcome_counts(p_run_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    jsonb_object_agg(outcome, outcome_count),
    '{}'::jsonb
  )
  FROM (
    SELECT outcome, COUNT(*)::integer AS outcome_count
    FROM reconciliation_results
    WHERE reconciliation_run_id = p_run_id
    GROUP BY outcome
  ) counts;
$$;
