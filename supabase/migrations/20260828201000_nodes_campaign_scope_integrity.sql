-- A node belongs to exactly one campaign. Child rows that store both
-- campaign_id and node_id must agree. Bare FKs to nodes(id) cannot check that
-- triangle, so add composite FKs targeting UNIQUE (campaign_id, id).
-- NOT VALID: enforce new writes immediately without scanning >1M message_jobs
-- under SHARE ROW EXCLUSIVE. Validation is a later migration.
--
-- Also drop idx_nodes_flow_node_id. The string "email-1" exists in every
-- campaign; the bare index makes an unscoped lookup look cheap. Every live
-- query already filters campaign_id; idx_nodes_campaign_flow_node and
-- nodes_campaign_id_flow_node_id_key cover them.

SET lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'nodes_campaign_id_id_key'
      AND conrelid = 'public.nodes'::regclass
  ) THEN
    ALTER TABLE public.nodes
      ADD CONSTRAINT nodes_campaign_id_id_key UNIQUE (campaign_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_jobs_campaign_node_fkey'
      AND conrelid = 'public.message_jobs'::regclass
  ) THEN
    ALTER TABLE public.message_jobs
      ADD CONSTRAINT message_jobs_campaign_node_fkey
      FOREIGN KEY (campaign_id, node_id) REFERENCES public.nodes (campaign_id, id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enrollments_campaign_current_node_fkey'
      AND conrelid = 'public.enrollments'::regclass
  ) THEN
    ALTER TABLE public.enrollments
      ADD CONSTRAINT enrollments_campaign_current_node_fkey
      FOREIGN KEY (campaign_id, current_node_id) REFERENCES public.nodes (campaign_id, id)
      ON DELETE SET NULL (current_node_id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaign_node_variant_state_campaign_node_fkey'
      AND conrelid = 'public.campaign_node_variant_state'::regclass
  ) THEN
    ALTER TABLE public.campaign_node_variant_state
      ADD CONSTRAINT campaign_node_variant_state_campaign_node_fkey
      FOREIGN KEY (campaign_id, node_id) REFERENCES public.nodes (campaign_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_nodes_flow_node_id;
