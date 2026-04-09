-- Cost rate cards (global defaults), per-run cost stamps, and export_row_cost_summary for per-row totals.

CREATE TABLE cost_rate_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  product TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cost_rate_cards_cost_kind_check CHECK (cost_kind IN ('acquisition', 'enrichment'))
);

CREATE INDEX idx_cost_rate_cards_lookup
  ON cost_rate_cards (cost_kind, provider, product, effective_from DESC);

COMMENT ON TABLE cost_rate_cards IS
  'Default unit prices per (cost_kind, provider, product); effective date range for rate history.';

ALTER TABLE cost_rate_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cost_rate_cards FROM anon, authenticated;

-- Seed defaults (adjust via Foundry Settings UI or SQL).
INSERT INTO cost_rate_cards (cost_kind, provider, product, unit_price_cents, currency, effective_from, notes)
VALUES
  ('acquisition', 'google_maps', 'import_row', 2, 'USD', now(), 'Default Google Maps import per-row'),
  ('enrichment', 'skipsherpa', 'person_lookup', 15, 'USD', now(), 'Default SkipSherpa person lookup');

ALTER TABLE contact_enrichment_attempts
  ADD COLUMN cost_amount_cents INTEGER,
  ADD COLUMN cost_rate_card_id UUID REFERENCES cost_rate_cards (id),
  ADD COLUMN cost_is_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN contact_enrichment_attempts.cost_amount_cents IS
  'Resolved unit cost for this billable attempt (minor units).';

ALTER TABLE ingestion_runs
  ADD COLUMN total_cost_cents INTEGER,
  ADD COLUMN cost_per_row_cents INTEGER,
  ADD COLUMN cost_rate_card_id UUID REFERENCES cost_rate_cards (id),
  ADD COLUMN cost_is_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ingestion_runs.cost_per_row_cents IS
  'Resolved per imported row at run completion; total_cost_cents = imported_rows * cost_per_row_cents.';

-- Per-export-row cost: enrichment from winning match + acquisition split across export rows for the company.
CREATE VIEW export_row_cost_summary
WITH (security_invoker = true)
AS
WITH enrichment_cost AS (
  SELECT DISTINCT ON (a.company_id, a.entity_owner_id)
    a.company_id,
    a.entity_owner_id,
    a.cost_amount_cents AS enrichment_cost_cents
  FROM contact_enrichment_attempts a
  INNER JOIN contact_enrichment_matches m ON m.attempt_id = a.id
  WHERE a.entity_owner_id IS NOT NULL
    AND a.cost_amount_cents IS NOT NULL
  ORDER BY a.company_id, a.entity_owner_id, a.performed_at DESC NULLS LAST
),
company_acquisition_cost AS (
  SELECT
    l.company_id,
    SUM(ir.cost_per_row_cents)::bigint AS company_total_acquisition_cents
  FROM source_business_company_links l
  INNER JOIN source_business_records sbr
    ON sbr.id = l.source_business_record_id
  INNER JOIN ingestion_runs ir
    ON ir.id = sbr.ingestion_run_id
  WHERE l.is_current = true
    AND l.link_status = 'linked'
    AND ir.cost_per_row_cents IS NOT NULL
  GROUP BY l.company_id
),
export_row_counts AS (
  SELECT
    company_id,
    COUNT(*)::bigint AS export_row_count
  FROM export_company_owner_leads
  GROUP BY company_id
)
SELECT
  ol.company_id,
  ol.entity_owner_id,
  COALESCE(ec.enrichment_cost_cents, 0) AS enrichment_cost_cents,
  COALESCE(ac.company_total_acquisition_cents, 0) AS company_acquisition_cost_cents,
  COALESCE(
    ac.company_total_acquisition_cents / NULLIF(erc.export_row_count, 0),
    0
  )::bigint AS acquisition_cost_per_row_cents,
  (
    COALESCE(ec.enrichment_cost_cents, 0)
    + COALESCE(
        ac.company_total_acquisition_cents / NULLIF(erc.export_row_count, 0),
        0
      )
  )::bigint AS total_cost_per_row_cents
FROM export_company_owner_leads ol
LEFT JOIN enrichment_cost ec
  ON ec.company_id = ol.company_id
  AND ec.entity_owner_id IS NOT DISTINCT FROM ol.entity_owner_id
LEFT JOIN company_acquisition_cost ac
  ON ac.company_id = ol.company_id
LEFT JOIN export_row_counts erc
  ON erc.company_id = ol.company_id;

COMMENT ON VIEW export_row_cost_summary IS
  'Per grain of export_company_owner_leads: enrichment from winning attempt; acquisition split evenly across export rows for the company.';

CREATE VIEW export_company_owner_leads_with_cost
WITH (security_invoker = true)
AS
SELECT
  l.*,
  COALESCE(c.enrichment_cost_cents, 0) AS enrichment_cost_cents,
  COALESCE(c.company_acquisition_cost_cents, 0) AS company_acquisition_cost_cents,
  COALESCE(c.acquisition_cost_per_row_cents, 0) AS acquisition_cost_per_row_cents,
  COALESCE(c.total_cost_per_row_cents, 0) AS total_cost_per_row_cents
FROM export_company_owner_leads l
LEFT JOIN export_row_cost_summary c
  ON c.company_id = l.company_id
  AND c.entity_owner_id IS NOT DISTINCT FROM l.entity_owner_id;

COMMENT ON VIEW export_company_owner_leads_with_cost IS
  'export_company_owner_leads plus per-row cost columns (no contact enrichment fields).';

DROP VIEW IF EXISTS export_company_owner_leads_with_contacts;

CREATE VIEW export_company_owner_leads_with_contacts
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
  COALESCE(c.company_acquisition_cost_cents, 0) AS company_acquisition_cost_cents,
  COALESCE(c.acquisition_cost_per_row_cents, 0) AS acquisition_cost_per_row_cents,
  COALESCE(c.total_cost_per_row_cents, 0) AS total_cost_per_row_cents
FROM export_company_owner_leads l
LEFT JOIN export_owner_contact_enrichment_flat f
  ON f.company_id = l.company_id
  AND f.entity_owner_id IS NOT DISTINCT FROM l.entity_owner_id
LEFT JOIN export_row_cost_summary c
  ON c.company_id = l.company_id
  AND c.entity_owner_id IS NOT DISTINCT FROM l.entity_owner_id;

COMMENT ON VIEW export_company_owner_leads_with_contacts IS
  'export_company_owner_leads plus contact enrichment flat columns and optional per-row cost columns from export_row_cost_summary.';
