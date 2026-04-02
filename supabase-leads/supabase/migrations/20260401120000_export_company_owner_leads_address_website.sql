-- Extend the Foundry export read model with structured address fields and a
-- single best linked website per company while preserving row cardinality.

CREATE OR REPLACE VIEW export_company_owner_leads
WITH (security_invoker = true)
AS
SELECT
  c.id AS company_id,
  c.legal_name,
  c.normalized_key,
  c.updated_at AS company_updated_at,
  c.notes AS company_notes,
  EXISTS (
    SELECT 1
    FROM source_business_company_links l
    WHERE l.company_id = c.id
      AND l.is_current = true
      AND l.link_status = 'linked'
  ) AS has_current_linked_source,
  (
    SELECT COUNT(DISTINCT l.source_business_record_id)::integer
    FROM source_business_company_links l
    WHERE l.company_id = c.id
      AND l.is_current = true
      AND l.link_status = 'linked'
  ) AS linked_source_count,
  m.id AS company_entity_match_id,
  m.registry_state,
  m.match_status,
  m.match_score,
  m.updated_at AS match_updated_at,
  se.id AS state_entity_id,
  se.registry_entity_id,
  se.state AS state_entity_state,
  se.legal_name AS state_entity_legal_name,
  eo.id AS entity_owner_id,
  eo.owner_name,
  eo.title_role,
  eo.effective_at,
  eo.ended_at,
  eo.observed_at,
  eo.source_snapshot_id AS owner_source_snapshot_id,
  se.source_snapshot_id AS entity_source_snapshot_id,
  COALESCE(eo.source_snapshot_id, se.source_snapshot_id) AS provenance_snapshot_id,
  snap.parser_version,
  pl.city AS primary_location_city,
  pl.state_region AS primary_location_state,
  (eo.id IS NOT NULL) AS has_current_owner,
  true AS has_promoted_match,
  EXISTS (
    SELECT 1
    FROM review_tasks rt
    WHERE rt.status IN ('pending', 'in_progress')
      AND rt.task_type <> 'parse_failure'
      AND (
        (rt.entity_type = 'company' AND rt.entity_id = c.id)
        OR (rt.entity_type = 'company_entity_match' AND rt.entity_id = m.id)
        OR (
          rt.entity_type = 'source_business_company_link'
          AND rt.entity_id IN (
            SELECT l2.id
            FROM source_business_company_links l2
            WHERE l2.company_id = c.id
              AND l2.is_current = true
          )
        )
        OR (
          rt.entity_type = 'source_business_record'
          AND rt.entity_id IN (
            SELECT l3.source_business_record_id
            FROM source_business_company_links l3
            WHERE l3.company_id = c.id
              AND l3.is_current = true
              AND l3.link_status = 'linked'
          )
        )
      )
  ) AS has_open_review_task,
  EXISTS (
    SELECT 1
    FROM review_tasks rt
    WHERE rt.task_type = 'parse_failure'
      AND rt.status IN ('pending', 'in_progress')
      AND (
        rt.entity_type = 'source_business_record'
        AND rt.entity_id IN (
          SELECT l4.source_business_record_id
          FROM source_business_company_links l4
          WHERE l4.company_id = c.id
            AND l4.is_current = true
            AND l4.link_status = 'linked'
        )
      )
  ) AS has_parse_failure_task,
  (
    (eo.id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM review_tasks rt
      WHERE rt.status IN ('pending', 'in_progress')
        AND rt.task_type <> 'parse_failure'
        AND (
          (rt.entity_type = 'company' AND rt.entity_id = c.id)
          OR (rt.entity_type = 'company_entity_match' AND rt.entity_id = m.id)
          OR (
            rt.entity_type = 'source_business_company_link'
            AND rt.entity_id IN (
              SELECT l2.id
              FROM source_business_company_links l2
              WHERE l2.company_id = c.id
                AND l2.is_current = true
            )
          )
          OR (
            rt.entity_type = 'source_business_record'
            AND rt.entity_id IN (
              SELECT l3.source_business_record_id
              FROM source_business_company_links l3
              WHERE l3.company_id = c.id
                AND l3.is_current = true
                AND l3.link_status = 'linked'
            )
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM review_tasks rt
      WHERE rt.task_type = 'parse_failure'
        AND rt.status IN ('pending', 'in_progress')
        AND (
          rt.entity_type = 'source_business_record'
          AND rt.entity_id IN (
            SELECT l4.source_business_record_id
            FROM source_business_company_links l4
            WHERE l4.company_id = c.id
              AND l4.is_current = true
              AND l4.link_status = 'linked'
          )
        )
    )
  ) AS is_export_ready,
  pl.line1 AS address_line_1,
  pl.line2 AS address_line_2,
  pl.city AS address_city,
  pl.state_region AS address_state,
  pl.postal_code AS address_postal_code,
  pl.country AS address_country,
  ws.website
FROM companies c
INNER JOIN company_entity_matches m
  ON m.company_id = c.id
  AND m.is_current = true
  AND m.match_status = 'promoted'
INNER JOIN state_entities se
  ON se.id = m.state_entity_id
LEFT JOIN entity_owners eo
  ON eo.state_entity_id = se.id
  AND eo.is_current = true
LEFT JOIN registry_source_snapshots snap
  ON snap.id = COALESCE(eo.source_snapshot_id, se.source_snapshot_id)
LEFT JOIN LATERAL (
  SELECT cl.line1, cl.line2, cl.city, cl.state_region, cl.postal_code, cl.country
  FROM company_locations cl
  WHERE cl.company_id = c.id
  ORDER BY cl.is_primary DESC NULLS LAST, cl.updated_at DESC, cl.created_at DESC
  LIMIT 1
) pl ON true
LEFT JOIN LATERAL (
  SELECT NULLIF(BTRIM(sbr.website), '') AS website
  FROM source_business_company_links l
  INNER JOIN source_business_records sbr
    ON sbr.id = l.source_business_record_id
  WHERE l.company_id = c.id
    AND l.is_current = true
    AND l.link_status = 'linked'
    AND NULLIF(BTRIM(sbr.website), '') IS NOT NULL
  ORDER BY l.created_at DESC, l.updated_at DESC, sbr.observed_at DESC, sbr.updated_at DESC
  LIMIT 1
) ws ON true;

COMMENT ON VIEW export_company_owner_leads IS
  'Foundry export read model: one row per current owner on promoted company↔state_entity matches; rows without owners use null owner fields.';
