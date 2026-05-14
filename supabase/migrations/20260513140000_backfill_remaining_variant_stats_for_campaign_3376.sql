-- Explicit historical attribution for the remaining ambiguous sent variant rows on
-- campaign 3376ffca-b6f8-48b6-9ed9-534c206bea88.
--
-- Operator-approved strategy:
-- 1. Rows from the A/B/C snapshot window are attributed to variant C.
-- 2. Rows from the later C/D snapshot window are split evenly between C and D
--    using created_at + id order for a stable 50/50 assignment.

DO $$
DECLARE
  v_campaign_id CONSTANT UUID := '3376ffca-b6f8-48b6-9ed9-534c206bea88'::UUID;
  v_node_id CONSTANT UUID := 'e48a797c-afed-40ca-bd2b-ca0f4ec2345f'::UUID;
  v_variant_c CONSTANT UUID := '6ada53ab-2831-4992-8d37-4a5006fc3616'::UUID;
  v_variant_d CONSTANT UUID := '101a7f0c-ea68-47ac-a5b3-9d8f1f48c5ee'::UUID;
  v_rows_updated BIGINT := 0;
BEGIN
  WITH sent_null_jobs AS (
    SELECT
      mj.id,
      mj.created_at,
      mj.message_data,
      COALESCE(mj.message_data->'lead_data', '{}'::JSONB) AS lead_data,
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('id', v->>'id', 'label', v->>'label')
            ORDER BY COALESCE(NULLIF(v->>'order', '')::INT, 999999), v->>'id')
          FROM jsonb_array_elements(COALESCE(mj.message_data->'node_config'->'variants', '[]'::JSONB)) AS t(v)
          WHERE (v->>'isActive') IS DISTINCT FROM 'false'
        ),
        '[]'::JSONB
      ) AS active_variants
    FROM message_jobs mj
    WHERE mj.campaign_id = v_campaign_id
      AND mj.node_id = v_node_id
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND mj.status = 'sent'
      AND mj.variant_id IS NULL
  ),
  cd_rows AS (
    SELECT
      s.id,
      ROW_NUMBER() OVER (ORDER BY s.created_at, s.id) AS row_num
    FROM sent_null_jobs s
    WHERE s.active_variants = jsonb_build_array(
      jsonb_build_object('id', v_variant_c::TEXT, 'label', 'C'),
      jsonb_build_object('id', v_variant_d::TEXT, 'label', 'D')
    )
  ),
  chosen_rows AS (
    SELECT
      s.id,
      s.lead_data,
      CASE
        WHEN s.active_variants = jsonb_build_array(
          jsonb_build_object('id', 'ce723e83-1089-466d-85bb-02d0215f1ecb', 'label', 'A'),
          jsonb_build_object('id', 'a9a25544-d90a-4943-b78d-0ebb5c450e95', 'label', 'B'),
          jsonb_build_object('id', v_variant_c::TEXT, 'label', 'C')
        ) THEN v_variant_c
        WHEN s.id IN (SELECT id FROM cd_rows)
          THEN CASE
            WHEN ((SELECT row_num FROM cd_rows WHERE cd_rows.id = s.id) % 2) = 1 THEN v_variant_c
            ELSE v_variant_d
          END
        ELSE NULL
      END AS chosen_variant_id
    FROM sent_null_jobs s
  ),
  repaired_rows AS (
    SELECT
      cr.id,
      cr.chosen_variant_id,
      CASE WHEN cr.chosen_variant_id = v_variant_d THEN 'D' ELSE 'C' END AS chosen_label,
      cr.lead_data,
      chosen_variant AS chosen_variant,
      jsonb_strip_nulls(
        jsonb_build_object(
          'subject', COALESCE(chosen_variant->>'subject', ''),
          'template', COALESCE(chosen_variant->>'template', ''),
          'body_html', chosen_variant->'body_html',
          'body_text', chosen_variant->'body_text',
          'body', COALESCE(chosen_variant->>'template', '')
        )
      ) AS merged_node_config
    FROM chosen_rows cr
    CROSS JOIN LATERAL (
      SELECT v AS chosen_variant
      FROM jsonb_array_elements(
        COALESCE(
          (SELECT message_data->'node_config'->'variants' FROM sent_null_jobs s WHERE s.id = cr.id),
          '[]'::JSONB
        )
      ) AS t(v)
      WHERE (v->>'id')::UUID = cr.chosen_variant_id
      LIMIT 1
    ) chosen
    WHERE cr.chosen_variant_id IS NOT NULL
  )
  UPDATE message_jobs AS mj
  SET
    variant_id = rr.chosen_variant_id,
    message_type = COALESCE(mj.message_type, 'campaign'),
    message_data = (
      COALESCE(mj.message_data, '{}'::JSONB) - 'node_config' - 'variant'
    ) || jsonb_build_object(
      'node_config', rr.merged_node_config,
      'variant', jsonb_build_object(
        'id', rr.chosen_variant_id::TEXT,
        'label_snapshot', rr.chosen_label
      ),
      'lead_data', rr.lead_data
    ),
    updated_at = NOW()
  FROM repaired_rows rr
  WHERE mj.id = rr.id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'Backfilled remaining sent variant rows for campaign 3376: %', v_rows_updated;
END;
$$;
