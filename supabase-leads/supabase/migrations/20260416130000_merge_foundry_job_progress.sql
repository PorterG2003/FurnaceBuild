CREATE OR REPLACE FUNCTION merge_foundry_job_progress(
  p_job_id UUID,
  p_patch JSONB
)
RETURNS VOID
LANGUAGE sql
VOLATILE
AS $$
  UPDATE foundry_jobs
  SET progress = COALESCE(progress, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb)
  WHERE id = p_job_id;
$$;
