-- Backfill broken campaign message_jobs created while batch_assign_jobs_to_interval
-- stopped persisting variant_id / merged variant snapshots.
--
-- This migration intentionally repairs only deterministic rows:
-- rows whose stored node_config snapshot has exactly one active variant.
-- Multi-active snapshots remain untouched because their exact assignment
-- order cannot be proven from the persisted data alone.

DO $$
DECLARE
  v_rows_updated BIGINT := 0;
BEGIN
  WITH deterministic_jobs AS (
    SELECT
      mj.id,
      (chosen.variant->>'id')::UUID AS chosen_variant_id,
      COALESCE(chosen.variant->>'label', 'A') AS chosen_label,
      COALESCE(mj.message_data->'lead_data', '{}'::JSONB) AS lead_data,
      jsonb_strip_nulls(
        jsonb_build_object(
          'subject', COALESCE(chosen.variant->>'subject', ''),
          'template', COALESCE(chosen.variant->>'template', ''),
          'body_html', chosen.variant->'body_html',
          'body_text', chosen.variant->'body_text',
          'body', COALESCE(chosen.variant->>'template', '')
        )
        || CASE
          WHEN COALESCE(mj.message_data->'node_config', '{}'::JSONB) ? 'mailboxId'
            THEN jsonb_build_object('mailboxId', mj.message_data->'node_config'->'mailboxId')
          ELSE '{}'::JSONB
        END
      ) AS merged_node_config
    FROM message_jobs mj
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(v ORDER BY COALESCE(NULLIF(v->>'order', '')::INT, 999999), v->>'id'),
        '[]'::JSONB
      ) AS active_variants
      FROM jsonb_array_elements(COALESCE(mj.message_data->'node_config'->'variants', '[]'::JSONB)) AS t(v)
      WHERE (v->>'isActive') IS DISTINCT FROM 'false'
    ) av
    CROSS JOIN LATERAL (
      SELECT av.active_variants->0 AS variant
    ) chosen
    WHERE (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.variant_id IS NULL
      AND jsonb_array_length(av.active_variants) = 1
      AND (chosen.variant->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  UPDATE message_jobs AS mj
  SET
    variant_id = dj.chosen_variant_id,
    message_type = COALESCE(mj.message_type, 'campaign'),
    message_data = (
      COALESCE(mj.message_data, '{}'::JSONB) - 'node_config' - 'variant'
    ) || jsonb_build_object(
      'node_config', dj.merged_node_config,
      'variant', jsonb_build_object(
        'id', dj.chosen_variant_id::TEXT,
        'label_snapshot', dj.chosen_label
      ),
      'lead_data', dj.lead_data
    ),
    updated_at = NOW()
  FROM deterministic_jobs dj
  WHERE mj.id = dj.id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'Backfilled deterministic null-variant campaign message_jobs: %', v_rows_updated;
END;
$$;
