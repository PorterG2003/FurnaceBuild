-- Validate the composite campaign+node FKs, then drop the redundant
-- single-column FKs to nodes(id). VALIDATE takes SHARE UPDATE EXCLUSIVE and
-- allows concurrent DML. Dropping the old FKs keeps insert-path trigger
-- work cost-neutral versus today.

SET statement_timeout = 0;

ALTER TABLE public.message_jobs
  VALIDATE CONSTRAINT message_jobs_campaign_node_fkey;

ALTER TABLE public.enrollments
  VALIDATE CONSTRAINT enrollments_campaign_current_node_fkey;

ALTER TABLE public.campaign_node_variant_state
  VALIDATE CONSTRAINT campaign_node_variant_state_campaign_node_fkey;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'public.nodes'::regclass
      AND conrelid IN (
        'public.message_jobs'::regclass,
        'public.enrollments'::regclass,
        'public.campaign_node_variant_state'::regclass
      )
      AND array_length(conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

SET statement_timeout = '30s';
