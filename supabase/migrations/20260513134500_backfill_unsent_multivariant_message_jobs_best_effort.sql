-- Best-effort repair for unsent campaign message_jobs whose variant assignment was lost
-- while batch_assign_jobs_to_interval stopped persisting variant_id / merged snapshots.
--
-- These rows cannot be repaired exactly because their stored node_config snapshot
-- had multiple active variants. We assign a stable round-robin order within each
-- (campaign_id, node_id, active_variants snapshot) bucket based on created_at + id.
--
-- Stale reserved/sending rows are re-queued so a worker reloads the repaired payload
-- instead of continuing with a previously reserved broken snapshot.

DO $$
DECLARE
  v_rows_updated BIGINT := 0;
BEGIN
  WITH candidate_jobs AS (
    SELECT
      mj.id,
      mj.campaign_id,
      mj.node_id,
      mj.status,
      mj.created_at,
      mj.updated_at,
      mj.reserved_at,
      mj.message_data,
      COALESCE(mj.message_data->'lead_data', '{}'::JSONB) AS lead_data,
      COALESCE(
        (
          SELECT jsonb_agg(v ORDER BY COALESCE(NULLIF(v->>'order', '')::INT, 999999), v->>'id')
          FROM jsonb_array_elements(COALESCE(mj.message_data->'node_config'->'variants', '[]'::JSONB)) AS t(v)
          WHERE (v->>'isActive') IS DISTINCT FROM 'false'
        ),
        '[]'::JSONB
      ) AS active_variants
    FROM message_jobs mj
    WHERE (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.variant_id IS NULL
      AND mj.status <> 'sent'
  ),
  ranked_jobs AS (
    SELECT
      cj.*,
      jsonb_array_length(cj.active_variants) AS active_variant_count,
      ROW_NUMBER() OVER (
        PARTITION BY cj.campaign_id, cj.node_id, cj.active_variants
        ORDER BY cj.created_at, cj.id
      ) - 1 AS zero_based_index
    FROM candidate_jobs cj
    WHERE jsonb_array_length(cj.active_variants) > 1
  ),
  chosen_jobs AS (
    SELECT
      rj.*,
      (rj.active_variants -> (rj.zero_based_index % rj.active_variant_count)::INT) AS chosen_variant
    FROM ranked_jobs rj
  ),
  repaired_jobs AS (
    SELECT
      cj.id,
      (cj.chosen_variant->>'id')::UUID AS chosen_variant_id,
      COALESCE(cj.chosen_variant->>'label', 'A') AS chosen_label,
      cj.lead_data,
      cj.status,
      cj.created_at,
      cj.updated_at,
      cj.reserved_at,
      jsonb_strip_nulls(
        jsonb_build_object(
          'subject', COALESCE(cj.chosen_variant->>'subject', ''),
          'template', COALESCE(cj.chosen_variant->>'template', ''),
          'body_html', cj.chosen_variant->'body_html',
          'body_text', cj.chosen_variant->'body_text',
          'body', COALESCE(cj.chosen_variant->>'template', '')
        )
        || CASE
          WHEN COALESCE(cj.message_data->'node_config', '{}'::JSONB) ? 'mailboxId'
            THEN jsonb_build_object('mailboxId', cj.message_data->'node_config'->'mailboxId')
          ELSE '{}'::JSONB
        END
      ) AS merged_node_config,
      (
        cj.status IN ('reserved', 'sending')
        AND COALESCE(cj.reserved_at, cj.updated_at, cj.created_at) < NOW() - INTERVAL '30 minutes'
      ) AS should_requeue
    FROM chosen_jobs cj
    WHERE (cj.chosen_variant->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  UPDATE message_jobs AS mj
  SET
    variant_id = rj.chosen_variant_id,
    message_type = COALESCE(mj.message_type, 'campaign'),
    message_data = (
      COALESCE(mj.message_data, '{}'::JSONB) - 'node_config' - 'variant'
    ) || jsonb_build_object(
      'node_config', rj.merged_node_config,
      'variant', jsonb_build_object(
        'id', rj.chosen_variant_id::TEXT,
        'label_snapshot', rj.chosen_label
      ),
      'lead_data', rj.lead_data
    ),
    status = CASE
      WHEN rj.should_requeue THEN 'queued'
      ELSE mj.status
    END,
    reserved_at = CASE
      WHEN rj.should_requeue THEN NULL
      ELSE mj.reserved_at
    END,
    status_reason = CASE
      WHEN rj.should_requeue THEN NULL
      ELSE mj.status_reason
    END,
    send_wait_reason = CASE
      WHEN rj.should_requeue THEN NULL
      ELSE mj.send_wait_reason
    END,
    updated_at = NOW()
  FROM repaired_jobs rj
  WHERE mj.id = rj.id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'Best-effort repaired unsent multi-variant campaign message_jobs: %', v_rows_updated;
END;
$$;
