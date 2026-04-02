-- Improve company_contact_projection by parsing address_raw into structured
-- export columns when canonical company_locations are missing and linked source
-- rows only provide a freeform US-style address string.

CREATE OR REPLACE VIEW company_contact_projection
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
parsed_source_records AS (
  SELECT
    lsr.*,
    parsed.parts[1] AS parsed_line1,
    parsed.parts[2] AS parsed_city,
    UPPER(parsed.parts[3]) AS parsed_state_region,
    parsed.parts[4] AS parsed_postal_code,
    parsed.parts[5] AS parsed_country
  FROM linked_source_records lsr
  LEFT JOIN LATERAL (
    SELECT regexp_match(
      regexp_replace(lsr.address_raw, '\s+', ' ', 'g'),
      '^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)(?:,\s*([^,]+))?$'
    ) AS parts
  ) parsed ON true
),
best_source_address AS (
  SELECT DISTINCT ON (psr.company_id)
    psr.company_id,
    COALESCE(psr.line1, psr.parsed_line1, psr.address_raw) AS line1,
    psr.line2,
    COALESCE(psr.city, psr.parsed_city) AS city,
    COALESCE(psr.state_region, psr.parsed_state_region) AS state_region,
    COALESCE(psr.postal_code, psr.parsed_postal_code) AS postal_code,
    COALESCE(psr.country, psr.parsed_country) AS country
  FROM parsed_source_records psr
  WHERE psr.line1 IS NOT NULL
    OR psr.line2 IS NOT NULL
    OR psr.city IS NOT NULL
    OR psr.state_region IS NOT NULL
    OR psr.postal_code IS NOT NULL
    OR psr.country IS NOT NULL
    OR psr.parsed_line1 IS NOT NULL
    OR psr.parsed_city IS NOT NULL
    OR psr.parsed_state_region IS NOT NULL
    OR psr.parsed_postal_code IS NOT NULL
    OR psr.parsed_country IS NOT NULL
    OR psr.address_raw IS NOT NULL
  ORDER BY
    psr.company_id,
    psr.link_created_at DESC,
    psr.link_updated_at DESC,
    psr.observed_at DESC,
    psr.source_updated_at DESC,
    psr.source_business_record_id DESC
),
best_source_website AS (
  SELECT DISTINCT ON (psr.company_id)
    psr.company_id,
    psr.website
  FROM parsed_source_records psr
  WHERE psr.website IS NOT NULL
  ORDER BY
    psr.company_id,
    psr.link_created_at DESC,
    psr.link_updated_at DESC,
    psr.observed_at DESC,
    psr.source_updated_at DESC,
    psr.source_business_record_id DESC
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
  'One row per company with export-safe company contact fields; prefers canonical company_locations and falls back to linked source_business_records, including best-effort parsing of address_raw.';
