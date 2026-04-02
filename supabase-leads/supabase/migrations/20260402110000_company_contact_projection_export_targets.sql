-- Redesign Foundry export around company-scoped contact projection and
-- company-level export targets. Both owner export rows and chain export targets
-- build on these views.

DROP VIEW IF EXISTS export_company_owner_leads;
DROP VIEW IF EXISTS export_company_targets;
DROP VIEW IF EXISTS company_contact_projection;

CREATE VIEW company_contact_projection
WITH (security_invoker = true)
AS
WITH primary_location AS (
  SELECT DISTINCT ON (cl.company_id)
    cl.company_id,
    NULLIF(BTRIM(cl.line1), '') AS line1,
    NULLIF(BTRIM(cl.line2), '') AS line2,
    NULLIF(BTRIM(cl.city), '') AS city,
    NULLIF(BTRIM(cl.state_region), '') AS state_region,
    NULLIF(BTRIM(cl.postal_code), '') AS postal_code,
    NULLIF(BTRIM(cl.country), '') AS country
  FROM company_locations cl
  ORDER BY cl.company_id, cl.is_primary DESC NULLS LAST, cl.updated_at DESC, cl.created_at DESC
),
linked_source_records AS (
  SELECT
    l.company_id,
    l.source_business_record_id,
    NULLIF(BTRIM(sbr.website), '') AS website,
    NULLIF(BTRIM(sbr.line1), '') AS line1,
    NULLIF(BTRIM(sbr.line2), '') AS line2,
    NULLIF(BTRIM(sbr.city), '') AS city,
    NULLIF(BTRIM(sbr.state_region), '') AS state_region,
    NULLIF(BTRIM(sbr.postal_code), '') AS postal_code,
    NULLIF(BTRIM(sbr.country), '') AS country,
    NULLIF(BTRIM(sbr.address_raw), '') AS address_raw,
    l.created_at AS link_created_at,
    l.updated_at AS link_updated_at,
    sbr.observed_at,
    sbr.updated_at AS source_updated_at
  FROM source_business_company_links l
  INNER JOIN source_business_records sbr
    ON sbr.id = l.source_business_record_id
  WHERE l.is_current = true
    AND l.link_status = 'linked'
),
best_source_address AS (
  SELECT DISTINCT ON (lsr.company_id)
    lsr.company_id,
    COALESCE(lsr.line1, lsr.address_raw) AS line1,
    lsr.line2,
    lsr.city,
    lsr.state_region,
    lsr.postal_code,
    lsr.country
  FROM linked_source_records lsr
  WHERE lsr.line1 IS NOT NULL
    OR lsr.line2 IS NOT NULL
    OR lsr.city IS NOT NULL
    OR lsr.state_region IS NOT NULL
    OR lsr.postal_code IS NOT NULL
    OR lsr.country IS NOT NULL
    OR lsr.address_raw IS NOT NULL
  ORDER BY
    lsr.company_id,
    lsr.link_created_at DESC,
    lsr.link_updated_at DESC,
    lsr.observed_at DESC,
    lsr.source_updated_at DESC,
    lsr.source_business_record_id DESC
),
best_source_website AS (
  SELECT DISTINCT ON (lsr.company_id)
    lsr.company_id,
    lsr.website
  FROM linked_source_records lsr
  WHERE lsr.website IS NOT NULL
  ORDER BY
    lsr.company_id,
    lsr.link_created_at DESC,
    lsr.link_updated_at DESC,
    lsr.observed_at DESC,
    lsr.source_updated_at DESC,
    lsr.source_business_record_id DESC
)
SELECT
  c.id AS company_id,
  COALESCE(pl.line1, bsa.line1) AS address_line_1,
  COALESCE(pl.line2, bsa.line2) AS address_line_2,
  COALESCE(pl.city, bsa.city) AS address_city,
  COALESCE(pl.state_region, bsa.state_region) AS address_state,
  COALESCE(pl.postal_code, bsa.postal_code) AS address_postal_code,
  COALESCE(pl.country, bsa.country) AS address_country,
  bsw.website AS website,
  pl.city AS primary_location_city,
  pl.state_region AS primary_location_state,
  CASE
    WHEN pl.company_id IS NOT NULL THEN 'company_location'
    WHEN bsa.company_id IS NOT NULL THEN 'linked_source_record'
    ELSE NULL
  END AS address_source_kind,
  CASE
    WHEN bsw.company_id IS NOT NULL THEN 'linked_source_record'
    ELSE NULL
  END AS website_source_kind
FROM companies c
LEFT JOIN primary_location pl
  ON pl.company_id = c.id
LEFT JOIN best_source_address bsa
  ON bsa.company_id = c.id
LEFT JOIN best_source_website bsw
  ON bsw.company_id = c.id;

COMMENT ON VIEW company_contact_projection IS
  'One row per company with export-safe company contact fields; prefers canonical company_locations and falls back to linked source_business_records.';

CREATE VIEW export_company_targets
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
  se.source_snapshot_id AS entity_source_snapshot_id,
  se.registry_entity_id,
  se.state AS state_entity_state,
  se.legal_name AS state_entity_legal_name,
  cp.address_line_1,
  cp.address_line_2,
  cp.address_city,
  cp.address_state,
  cp.address_postal_code,
  cp.address_country,
  cp.primary_location_city,
  cp.primary_location_state,
  cp.website,
  EXISTS (
    SELECT 1
    FROM entity_owners eo
    WHERE eo.state_entity_id = se.id
      AND eo.is_current = true
  ) AS has_current_owner,
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
      AND rt.entity_type = 'source_business_record'
      AND rt.entity_id IN (
        SELECT l4.source_business_record_id
        FROM source_business_company_links l4
        WHERE l4.company_id = c.id
          AND l4.is_current = true
          AND l4.link_status = 'linked'
      )
  ) AS has_parse_failure_task,
  (
    EXISTS (
      SELECT 1
      FROM entity_owners eo2
      WHERE eo2.state_entity_id = se.id
        AND eo2.is_current = true
    )
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
        AND rt.entity_type = 'source_business_record'
        AND rt.entity_id IN (
          SELECT l4.source_business_record_id
          FROM source_business_company_links l4
          WHERE l4.company_id = c.id
            AND l4.is_current = true
            AND l4.link_status = 'linked'
        )
    )
  ) AS is_export_ready
FROM companies c
INNER JOIN company_entity_matches m
  ON m.company_id = c.id
  AND m.is_current = true
  AND m.match_status = 'promoted'
INNER JOIN state_entities se
  ON se.id = m.state_entity_id
LEFT JOIN company_contact_projection cp
  ON cp.company_id = c.id;

COMMENT ON VIEW export_company_targets IS
  'One row per promoted company↔state_entity target for export; includes export readiness and company-scoped contact fields.';

CREATE VIEW export_company_owner_leads
WITH (security_invoker = true)
AS
SELECT
  t.company_id,
  t.legal_name,
  t.normalized_key,
  t.company_updated_at,
  t.company_notes,
  t.has_current_linked_source,
  t.linked_source_count,
  t.company_entity_match_id,
  t.registry_state,
  t.match_status,
  t.match_score,
  t.match_updated_at,
  t.state_entity_id,
  t.registry_entity_id,
  t.state_entity_state,
  t.state_entity_legal_name,
  eo.id AS entity_owner_id,
  eo.owner_name,
  eo.title_role,
  eo.effective_at,
  eo.ended_at,
  eo.observed_at,
  eo.source_snapshot_id AS owner_source_snapshot_id,
  t.entity_source_snapshot_id,
  COALESCE(eo.source_snapshot_id, t.entity_source_snapshot_id) AS provenance_snapshot_id,
  snap.parser_version,
  t.address_line_1,
  t.address_line_2,
  t.address_city,
  t.address_state,
  t.address_postal_code,
  t.address_country,
  t.primary_location_city,
  t.primary_location_state,
  t.website,
  t.has_current_owner,
  t.has_promoted_match,
  t.has_open_review_task,
  t.has_parse_failure_task,
  t.is_export_ready
FROM export_company_targets t
LEFT JOIN entity_owners eo
  ON eo.state_entity_id = t.state_entity_id
  AND eo.is_current = true
LEFT JOIN registry_source_snapshots snap
  ON snap.id = COALESCE(eo.source_snapshot_id, t.entity_source_snapshot_id);

COMMENT ON VIEW export_company_owner_leads IS
  'One row per current owner on an export_company_target; targets without owners use null owner fields.';
