DROP VIEW IF EXISTS export_company_owner_leads_with_contacts;
DROP VIEW IF EXISTS export_company_owner_leads_with_cost;
DROP VIEW IF EXISTS export_row_cost_summary;

CREATE OR REPLACE VIEW export_row_cost_summary
WITH (security_invoker = true)
AS
WITH owner_direct_enrichment AS (
  SELECT DISTINCT ON (a.company_id, a.entity_owner_id)
    a.company_id,
    a.entity_owner_id,
    cr.cost_amount_micros AS owner_direct_enrichment_micros
  FROM contact_enrichment_attempts a
  INNER JOIN contact_enrichment_matches m
    ON m.attempt_id = a.id
  INNER JOIN cost_records cr
    ON cr.id = a.cost_record_id
   AND cr.record_kind = 'direct'
   AND cr.cost_kind = 'enrichment'
  WHERE a.entity_owner_id IS NOT NULL
  ORDER BY a.company_id, a.entity_owner_id, a.performed_at DESC NULLS LAST
),
company_runtime_enrichment AS (
  SELECT
    cr.company_id,
    SUM(cr.cost_amount_micros) FILTER (
      WHERE cr.source_entity_type = 'company_website_verification'
    )::numeric AS website_verification_micros,
    SUM(cr.cost_amount_micros) FILTER (
      WHERE cr.source_entity_type = 'company_google_ads_verification'
    )::numeric AS google_ads_verification_micros,
    SUM(cr.cost_amount_micros) FILTER (
      WHERE cr.source_entity_type = 'company_website_intelligence'
    )::numeric AS website_intelligence_micros
  FROM cost_records cr
  WHERE cr.record_kind = 'direct'
    AND cr.cost_kind = 'enrichment'
    AND cr.company_id IS NOT NULL
    AND cr.source_entity_type IN (
      'company_website_verification',
      'company_google_ads_verification',
      'company_website_intelligence'
    )
  GROUP BY cr.company_id
),
company_import_acquisition AS (
  SELECT
    l.company_id,
    SUM(
      CASE
        WHEN cr.usage_quantity > 0
          THEN cr.cost_amount_micros::numeric / cr.usage_quantity::numeric
        ELSE 0
      END
    ) AS import_acquisition_micros
  FROM source_business_company_links l
  INNER JOIN source_business_records sbr
    ON sbr.id = l.source_business_record_id
  INNER JOIN ingestion_runs ir
    ON ir.id = sbr.ingestion_run_id
  INNER JOIN cost_records cr
    ON cr.id = ir.cost_record_id
   AND cr.record_kind = 'direct'
   AND cr.cost_kind = 'acquisition'
  WHERE l.is_current = true
    AND l.link_status = 'linked'
  GROUP BY l.company_id
),
company_registry_acquisition AS (
  SELECT
    cr.company_id,
    SUM(cr.cost_amount_micros)::numeric AS registry_acquisition_micros
  FROM cost_records cr
  WHERE cr.record_kind = 'direct'
    AND cr.cost_kind = 'acquisition'
    AND cr.company_id IS NOT NULL
    AND cr.source_entity_type = 'registry_source_snapshot'
  GROUP BY cr.company_id
),
export_row_counts AS (
  SELECT
    company_id,
    COUNT(*)::integer AS export_row_count
  FROM export_company_owner_leads
  GROUP BY company_id
)
SELECT
  ol.company_id,
  ol.entity_owner_id,
  COALESCE(ode.owner_direct_enrichment_micros, 0) / 10000.0 AS enrichment_cost_cents,
  (
    COALESCE(cre.website_verification_micros, 0)
    + COALESCE(cre.google_ads_verification_micros, 0)
    + COALESCE(cre.website_intelligence_micros, 0)
  ) / 10000.0 AS company_enrichment_cost_cents,
  COALESCE(
    (
      COALESCE(cre.website_verification_micros, 0)
      + COALESCE(cre.google_ads_verification_micros, 0)
      + COALESCE(cre.website_intelligence_micros, 0)
    ) / NULLIF(erc.export_row_count, 0),
    0
  ) / 10000.0 AS enrichment_cost_per_row_cents,
  (
    COALESCE(cia.import_acquisition_micros, 0)
    + COALESCE(cra.registry_acquisition_micros, 0)
  ) / 10000.0 AS company_acquisition_cost_cents,
  COALESCE(
    (
      COALESCE(cia.import_acquisition_micros, 0)
      + COALESCE(cra.registry_acquisition_micros, 0)
    ) / NULLIF(erc.export_row_count, 0),
    0
  ) / 10000.0 AS acquisition_cost_per_row_cents,
  (
    COALESCE(ode.owner_direct_enrichment_micros, 0)
    + COALESCE(
        (
          COALESCE(cre.website_verification_micros, 0)
          + COALESCE(cre.google_ads_verification_micros, 0)
          + COALESCE(cre.website_intelligence_micros, 0)
        ) / NULLIF(erc.export_row_count, 0),
        0
      )
    + COALESCE(
        (
          COALESCE(cia.import_acquisition_micros, 0)
          + COALESCE(cra.registry_acquisition_micros, 0)
        ) / NULLIF(erc.export_row_count, 0),
        0
      )
  ) / 10000.0 AS total_cost_per_row_cents,
  COALESCE(erc.export_row_count, 0) AS company_export_row_count,
  COALESCE(cre.website_verification_micros, 0) / 10000.0 AS company_website_verification_cost_cents,
  COALESCE(cre.google_ads_verification_micros, 0) / 10000.0 AS company_google_ads_verification_cost_cents,
  COALESCE(cre.website_intelligence_micros, 0) / 10000.0 AS company_website_intelligence_cost_cents,
  COALESCE(cia.import_acquisition_micros, 0) / 10000.0 AS company_import_acquisition_cost_cents,
  COALESCE(cra.registry_acquisition_micros, 0) / 10000.0 AS company_registry_acquisition_cost_cents
FROM export_company_owner_leads ol
LEFT JOIN owner_direct_enrichment ode
  ON ode.company_id = ol.company_id
  AND ode.entity_owner_id IS NOT DISTINCT FROM ol.entity_owner_id
LEFT JOIN company_runtime_enrichment cre
  ON cre.company_id = ol.company_id
LEFT JOIN company_import_acquisition cia
  ON cia.company_id = ol.company_id
LEFT JOIN company_registry_acquisition cra
  ON cra.company_id = ol.company_id
LEFT JOIN export_row_counts erc
  ON erc.company_id = ol.company_id;

COMMENT ON VIEW export_row_cost_summary IS
  'Owner-row export cost summary sourced from canonical cost_records with exact fractional-cent values plus explicit component breakdown columns for CSV explainability.';

CREATE OR REPLACE VIEW export_company_owner_leads_with_cost
WITH (security_invoker = true)
AS
SELECT
  l.*,
  COALESCE(c.enrichment_cost_cents, 0) AS enrichment_cost_cents,
  COALESCE(c.company_enrichment_cost_cents, 0) AS company_enrichment_cost_cents,
  COALESCE(c.enrichment_cost_per_row_cents, 0) AS enrichment_cost_per_row_cents,
  COALESCE(c.company_acquisition_cost_cents, 0) AS company_acquisition_cost_cents,
  COALESCE(c.acquisition_cost_per_row_cents, 0) AS acquisition_cost_per_row_cents,
  COALESCE(c.total_cost_per_row_cents, 0) AS total_cost_per_row_cents,
  COALESCE(c.company_export_row_count, 0) AS company_export_row_count,
  COALESCE(c.company_website_verification_cost_cents, 0) AS company_website_verification_cost_cents,
  COALESCE(c.company_google_ads_verification_cost_cents, 0) AS company_google_ads_verification_cost_cents,
  COALESCE(c.company_website_intelligence_cost_cents, 0) AS company_website_intelligence_cost_cents,
  COALESCE(c.company_import_acquisition_cost_cents, 0) AS company_import_acquisition_cost_cents,
  COALESCE(c.company_registry_acquisition_cost_cents, 0) AS company_registry_acquisition_cost_cents
FROM export_company_owner_leads l
LEFT JOIN export_row_cost_summary c
  ON c.company_id = l.company_id
  AND c.entity_owner_id IS NOT DISTINCT FROM l.entity_owner_id;

COMMENT ON VIEW export_company_owner_leads_with_cost IS
  'export_company_owner_leads plus exact fractional-cent owner-direct and allocated company-level cost columns with component breakdown fields for CSV export.';

CREATE OR REPLACE VIEW export_company_owner_leads_with_contacts
WITH (security_invoker = true)
AS
SELECT
  l.*,
  f.contact_email_1,
  f.contact_email_2,
  f.contact_email_3,
  f.contact_phone_1,
  f.contact_phone_1_type,
  f.contact_phone_1_is_dnc,
  f.contact_phone_1_dnc_summary,
  f.contact_phone_2,
  f.contact_phone_2_type,
  f.contact_phone_2_is_dnc,
  f.contact_phone_2_dnc_summary,
  f.contact_phone_3,
  f.contact_phone_3_type,
  f.contact_phone_3_is_dnc,
  f.contact_phone_3_dnc_summary,
  f.contact_confidence_tier,
  f.contact_enrichment_top_score,
  f.contact_enrichment_score_margin,
  f.contact_enrichment_reason_summary,
  COALESCE(c.enrichment_cost_cents, 0) AS enrichment_cost_cents,
  COALESCE(c.company_enrichment_cost_cents, 0) AS company_enrichment_cost_cents,
  COALESCE(c.enrichment_cost_per_row_cents, 0) AS enrichment_cost_per_row_cents,
  COALESCE(c.company_acquisition_cost_cents, 0) AS company_acquisition_cost_cents,
  COALESCE(c.acquisition_cost_per_row_cents, 0) AS acquisition_cost_per_row_cents,
  COALESCE(c.total_cost_per_row_cents, 0) AS total_cost_per_row_cents,
  COALESCE(c.company_export_row_count, 0) AS company_export_row_count,
  COALESCE(c.company_website_verification_cost_cents, 0) AS company_website_verification_cost_cents,
  COALESCE(c.company_google_ads_verification_cost_cents, 0) AS company_google_ads_verification_cost_cents,
  COALESCE(c.company_website_intelligence_cost_cents, 0) AS company_website_intelligence_cost_cents,
  COALESCE(c.company_import_acquisition_cost_cents, 0) AS company_import_acquisition_cost_cents,
  COALESCE(c.company_registry_acquisition_cost_cents, 0) AS company_registry_acquisition_cost_cents
FROM export_company_owner_leads l
LEFT JOIN export_owner_contact_enrichment_flat f
  ON f.company_id = l.company_id
  AND f.entity_owner_id IS NOT DISTINCT FROM l.entity_owner_id
LEFT JOIN export_row_cost_summary c
  ON c.company_id = l.company_id
  AND c.entity_owner_id IS NOT DISTINCT FROM l.entity_owner_id;

COMMENT ON VIEW export_company_owner_leads_with_contacts IS
  'export_company_owner_leads plus contact enrichment flat columns and exact fractional-cent canonical cost columns with component breakdown fields from export_row_cost_summary.';
