-- Unified cost ledger: canonical cost_records, source-row linking/status, runtime rate-card units,
-- and compatibility backfill for existing import/contact enrichment costs.

ALTER TABLE cost_rate_cards
  ADD COLUMN usage_unit TEXT,
  ADD COLUMN unit_quantity BIGINT;

UPDATE cost_rate_cards
SET
  usage_unit = CASE
    WHEN provider = 'google_maps' AND product = 'import_row' THEN 'row'
    WHEN provider = 'skipsherpa' AND product = 'person_lookup' THEN 'lookup'
    ELSE 'row'
  END,
  unit_quantity = 1
WHERE usage_unit IS NULL
   OR unit_quantity IS NULL;

ALTER TABLE cost_rate_cards
  ALTER COLUMN usage_unit SET NOT NULL,
  ALTER COLUMN unit_quantity SET NOT NULL,
  ALTER COLUMN usage_unit SET DEFAULT 'row',
  ALTER COLUMN unit_quantity SET DEFAULT 1;

ALTER TABLE cost_rate_cards
  ADD CONSTRAINT cost_rate_cards_unit_quantity_check CHECK (unit_quantity > 0);

COMMENT ON COLUMN cost_rate_cards.usage_unit IS
  'Native priced unit for this card (e.g. row, lookup, ms).';

COMMENT ON COLUMN cost_rate_cards.unit_quantity IS
  'How many usage_unit units are covered by unit_price_cents (default 1; runtime cards may use hour-sized ms buckets).';

INSERT INTO cost_rate_cards (cost_kind, provider, product, usage_unit, unit_quantity, unit_price_cents, currency, effective_from, notes)
VALUES
  ('enrichment', 'furnace_runtime', 'website_verification_ms', 'ms', 3600000, 5, 'USD', now(), 'Default runtime estimate: 5 cents per hour of website verification worker time'),
  ('enrichment', 'furnace_runtime', 'google_ads_verification_ms', 'ms', 3600000, 5, 'USD', now(), 'Default runtime estimate: 5 cents per hour of Google Ads verification worker time'),
  ('acquisition', 'furnace_runtime', 'utah_registry_pull_ms', 'ms', 3600000, 5, 'USD', now(), 'Default runtime estimate: 5 cents per hour of Utah registry pull time'),
  ('acquisition', 'furnace_runtime', 'florida_registry_pull_ms', 'ms', 3600000, 5, 'USD', now(), 'Default runtime estimate: 5 cents per hour of Florida registry pull time');

CREATE TABLE cost_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cost_kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  product TEXT NOT NULL,
  usage_quantity BIGINT NOT NULL,
  usage_unit TEXT NOT NULL,
  cost_amount_micros BIGINT NOT NULL,
  cost_amount_cents INTEGER GENERATED ALWAYS AS (((ROUND(cost_amount_micros::numeric / 10000.0))::integer)) STORED,
  currency TEXT NOT NULL DEFAULT 'USD',
  cost_rate_card_id UUID REFERENCES cost_rate_cards (id),
  cost_is_override BOOLEAN NOT NULL DEFAULT false,
  record_kind TEXT NOT NULL,
  estimation_kind TEXT,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES ingestion_runs (id) ON DELETE SET NULL,
  foundry_job_id UUID REFERENCES foundry_jobs (id) ON DELETE SET NULL,
  reconciliation_run_id UUID REFERENCES reconciliation_runs (id) ON DELETE SET NULL,
  parent_cost_record_id UUID REFERENCES cost_records (id) ON DELETE SET NULL,
  allocation_method TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cost_records_cost_kind_check CHECK (cost_kind IN ('acquisition', 'enrichment')),
  CONSTRAINT cost_records_usage_quantity_check CHECK (usage_quantity >= 0),
  CONSTRAINT cost_records_cost_amount_micros_check CHECK (cost_amount_micros >= 0),
  CONSTRAINT cost_records_record_kind_check CHECK (record_kind IN ('direct', 'allocated')),
  CONSTRAINT cost_records_allocation_parent_check CHECK (
    (record_kind = 'allocated' AND parent_cost_record_id IS NOT NULL)
    OR record_kind = 'direct'
  )
);

COMMENT ON TABLE cost_records IS
  'Canonical cost ledger. One direct row per owning source record; optional child rows may materialize allocations later.';

COMMENT ON COLUMN cost_records.cost_amount_micros IS
  'Canonical amount in USD micro-dollars (1 cent = 10,000 micros). Preserves sub-cent runtime cost precision.';

COMMENT ON COLUMN cost_records.cost_amount_cents IS
  'Rounded presentation amount in whole USD cents, generated from cost_amount_micros.';

ALTER TABLE cost_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cost_records FROM anon, authenticated;

CREATE UNIQUE INDEX uniq_cost_records_direct_source
  ON cost_records (source_entity_type, source_entity_id)
  WHERE record_kind = 'direct';

CREATE INDEX idx_cost_records_source_lookup
  ON cost_records (source_entity_type, source_entity_id);

CREATE INDEX idx_cost_records_company_created
  ON cost_records (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX idx_cost_records_ingestion_run_created
  ON cost_records (ingestion_run_id, created_at DESC)
  WHERE ingestion_run_id IS NOT NULL;

CREATE INDEX idx_cost_records_foundry_job_created
  ON cost_records (foundry_job_id, created_at DESC)
  WHERE foundry_job_id IS NOT NULL;

CREATE INDEX idx_cost_records_reconciliation_run_created
  ON cost_records (reconciliation_run_id, created_at DESC)
  WHERE reconciliation_run_id IS NOT NULL;

CREATE INDEX idx_cost_records_parent
  ON cost_records (parent_cost_record_id)
  WHERE parent_cost_record_id IS NOT NULL;

CREATE INDEX idx_cost_records_pricing
  ON cost_records (cost_kind, provider, product, created_at DESC);

CREATE INDEX idx_cost_records_record_kind
  ON cost_records (record_kind, created_at DESC);

ALTER TABLE ingestion_runs
  ADD COLUMN cost_record_id UUID REFERENCES cost_records (id) ON DELETE SET NULL,
  ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'pre_cost_implementation_or_not_backfilled';

ALTER TABLE ingestion_runs
  ADD CONSTRAINT ingestion_runs_cost_status_check CHECK (
    cost_status IN ('costed', 'failed_or_not_costed', 'pre_cost_implementation_or_not_backfilled')
  );

CREATE UNIQUE INDEX uniq_ingestion_runs_cost_record
  ON ingestion_runs (cost_record_id)
  WHERE cost_record_id IS NOT NULL;

ALTER TABLE contact_enrichment_attempts
  ADD COLUMN cost_record_id UUID REFERENCES cost_records (id) ON DELETE SET NULL,
  ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'pre_cost_implementation_or_not_backfilled';

ALTER TABLE contact_enrichment_attempts
  ADD CONSTRAINT contact_enrichment_attempts_cost_status_check CHECK (
    cost_status IN ('costed', 'failed_or_not_costed', 'pre_cost_implementation_or_not_backfilled')
  );

CREATE UNIQUE INDEX uniq_contact_enrichment_attempts_cost_record
  ON contact_enrichment_attempts (cost_record_id)
  WHERE cost_record_id IS NOT NULL;

ALTER TABLE company_website_verifications
  ADD COLUMN cost_record_id UUID REFERENCES cost_records (id) ON DELETE SET NULL,
  ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'pre_cost_implementation_or_not_backfilled',
  ADD COLUMN elapsed_ms BIGINT;

ALTER TABLE company_website_verifications
  ADD CONSTRAINT company_website_verifications_cost_status_check CHECK (
    cost_status IN ('costed', 'failed_or_not_costed', 'pre_cost_implementation_or_not_backfilled')
  ),
  ADD CONSTRAINT company_website_verifications_elapsed_ms_check CHECK (
    elapsed_ms IS NULL OR elapsed_ms >= 0
  );

CREATE UNIQUE INDEX uniq_company_website_verifications_cost_record
  ON company_website_verifications (cost_record_id)
  WHERE cost_record_id IS NOT NULL;

ALTER TABLE company_google_ads_verifications
  ADD COLUMN cost_record_id UUID REFERENCES cost_records (id) ON DELETE SET NULL,
  ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'pre_cost_implementation_or_not_backfilled',
  ADD COLUMN elapsed_ms BIGINT;

ALTER TABLE company_google_ads_verifications
  ADD CONSTRAINT company_google_ads_verifications_cost_status_check CHECK (
    cost_status IN ('costed', 'failed_or_not_costed', 'pre_cost_implementation_or_not_backfilled')
  ),
  ADD CONSTRAINT company_google_ads_verifications_elapsed_ms_check CHECK (
    elapsed_ms IS NULL OR elapsed_ms >= 0
  );

CREATE UNIQUE INDEX uniq_company_google_ads_verifications_cost_record
  ON company_google_ads_verifications (cost_record_id)
  WHERE cost_record_id IS NOT NULL;

ALTER TABLE registry_source_snapshots
  ADD COLUMN cost_record_id UUID REFERENCES cost_records (id) ON DELETE SET NULL,
  ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'pre_cost_implementation_or_not_backfilled',
  ADD COLUMN elapsed_ms BIGINT;

ALTER TABLE registry_source_snapshots
  ADD CONSTRAINT registry_source_snapshots_cost_status_check CHECK (
    cost_status IN ('costed', 'failed_or_not_costed', 'pre_cost_implementation_or_not_backfilled')
  ),
  ADD CONSTRAINT registry_source_snapshots_elapsed_ms_check CHECK (
    elapsed_ms IS NULL OR elapsed_ms >= 0
  );

CREATE UNIQUE INDEX uniq_registry_source_snapshots_cost_record
  ON registry_source_snapshots (cost_record_id)
  WHERE cost_record_id IS NOT NULL;

WITH inserted AS (
  INSERT INTO cost_records (
    cost_kind,
    provider,
    product,
    usage_quantity,
    usage_unit,
    cost_amount_micros,
    currency,
    cost_rate_card_id,
    cost_is_override,
    record_kind,
    estimation_kind,
    source_entity_type,
    source_entity_id,
    ingestion_run_id,
    meta,
    created_at
  )
  SELECT
    'acquisition',
    ir.source_name,
    'import_row',
    (ir.stats->>'imported_rows')::bigint,
    'row',
    (ir.total_cost_cents::bigint * 10000),
    'USD',
    ir.cost_rate_card_id,
    ir.cost_is_override,
    'direct',
    'fixed_rate',
    'ingestion_run',
    ir.id,
    ir.id,
    jsonb_build_object(
      'legacy_cost_per_row_cents', ir.cost_per_row_cents,
      'legacy_total_cost_cents', ir.total_cost_cents
    ),
    ir.created_at
  FROM ingestion_runs ir
  WHERE ir.cost_record_id IS NULL
    AND ir.cost_per_row_cents IS NOT NULL
    AND ir.total_cost_cents IS NOT NULL
    AND COALESCE(ir.stats->>'imported_rows', '') ~ '^[0-9]+$'
    AND (ir.stats->>'imported_rows')::bigint > 0
  RETURNING id, source_entity_id
)
UPDATE ingestion_runs ir
SET
  cost_record_id = inserted.id,
  cost_status = 'costed'
FROM inserted
WHERE ir.id = inserted.source_entity_id;

UPDATE ingestion_runs
SET cost_status = 'failed_or_not_costed'
WHERE cost_record_id IS NULL
  AND status IN ('failed', 'cancelled');

WITH attempt_rows AS (
  SELECT
    a.id,
    a.provider,
    a.lookup_type,
    a.company_id,
    a.ingestion_run_id,
    a.foundry_job_id,
    a.entity_owner_id,
    CASE
      WHEN COALESCE(a.decision_metadata->>'hits_billed', '') ~ '^[0-9]+$' THEN (a.decision_metadata->>'hits_billed')::bigint
      WHEN a.is_billable_candidate THEN 1
      ELSE 0
    END AS usage_quantity,
    COALESCE(a.cost_amount_cents, 0)::bigint * 10000 AS cost_amount_micros,
    a.cost_rate_card_id,
    a.cost_is_override,
    a.performed_at
  FROM contact_enrichment_attempts a
  WHERE a.cost_record_id IS NULL
    AND a.classification <> 'error'
),
inserted AS (
  INSERT INTO cost_records (
    cost_kind,
    provider,
    product,
    usage_quantity,
    usage_unit,
    cost_amount_micros,
    currency,
    cost_rate_card_id,
    cost_is_override,
    record_kind,
    estimation_kind,
    source_entity_type,
    source_entity_id,
    company_id,
    ingestion_run_id,
    foundry_job_id,
    meta,
    created_at
  )
  SELECT
    'enrichment',
    provider,
    'person_lookup',
    usage_quantity,
    'lookup',
    cost_amount_micros,
    'USD',
    cost_rate_card_id,
    cost_is_override,
    'direct',
    'vendor_direct',
    'contact_enrichment_attempt',
    id,
    company_id,
    ingestion_run_id,
    foundry_job_id,
    jsonb_build_object('entity_owner_id', entity_owner_id),
    performed_at
  FROM attempt_rows
  RETURNING id, source_entity_id
)
UPDATE contact_enrichment_attempts a
SET
  cost_record_id = inserted.id,
  cost_status = 'costed'
FROM inserted
WHERE a.id = inserted.source_entity_id;

UPDATE contact_enrichment_attempts
SET cost_status = 'failed_or_not_costed'
WHERE cost_record_id IS NULL
  AND classification = 'error';

UPDATE company_google_ads_verifications
SET
  elapsed_ms = CASE
    WHEN COALESCE(lookup_stats->>'elapsed_ms', '') ~ '^[0-9]+$' THEN (lookup_stats->>'elapsed_ms')::bigint
    ELSE NULL
  END
WHERE elapsed_ms IS NULL;

WITH google_rate AS (
  SELECT id, unit_price_cents, unit_quantity
  FROM cost_rate_cards
  WHERE cost_kind = 'enrichment'
    AND provider = 'furnace_runtime'
    AND product = 'google_ads_verification_ms'
    AND effective_to IS NULL
  ORDER BY effective_from DESC
  LIMIT 1
),
inserted AS (
  INSERT INTO cost_records (
    cost_kind,
    provider,
    product,
    usage_quantity,
    usage_unit,
    cost_amount_micros,
    currency,
    cost_rate_card_id,
    cost_is_override,
    record_kind,
    estimation_kind,
    source_entity_type,
    source_entity_id,
    company_id,
    ingestion_run_id,
    foundry_job_id,
    meta,
    created_at
  )
  SELECT
    'enrichment',
    'furnace_runtime',
    'google_ads_verification_ms',
    g.elapsed_ms,
    'ms',
    ROUND(((g.elapsed_ms::numeric * gr.unit_price_cents::numeric * 10000.0) / gr.unit_quantity::numeric))::bigint,
    'USD',
    gr.id,
    false,
    'direct',
    'runtime_estimate',
    'company_google_ads_verification',
    g.id,
    g.company_id,
    g.source_ingestion_run_id,
    g.foundry_job_id,
    jsonb_build_object('result', g.result),
    g.created_at
  FROM company_google_ads_verifications g
  CROSS JOIN google_rate gr
  WHERE g.cost_record_id IS NULL
    AND g.error IS NULL
    AND g.elapsed_ms IS NOT NULL
    AND g.elapsed_ms >= 0
  RETURNING id, source_entity_id
)
UPDATE company_google_ads_verifications g
SET
  cost_record_id = inserted.id,
  cost_status = 'costed'
FROM inserted
WHERE g.id = inserted.source_entity_id;

UPDATE company_google_ads_verifications
SET cost_status = 'failed_or_not_costed'
WHERE cost_record_id IS NULL
  AND error IS NOT NULL;

UPDATE company_website_verifications
SET cost_status = 'failed_or_not_costed'
WHERE cost_record_id IS NULL
  AND error IS NOT NULL;

COMMENT ON COLUMN ingestion_runs.cost_record_id IS
  'Canonical direct cost ledger row for this import run when costed.';

COMMENT ON COLUMN contact_enrichment_attempts.cost_record_id IS
  'Canonical direct cost ledger row for this evaluated contact enrichment attempt when costed.';

COMMENT ON COLUMN company_website_verifications.cost_record_id IS
  'Canonical direct cost ledger row for this company-level website verification attempt when costed.';

COMMENT ON COLUMN company_google_ads_verifications.cost_record_id IS
  'Canonical direct cost ledger row for this company-level Google Ads verification attempt when costed.';

COMMENT ON COLUMN registry_source_snapshots.cost_record_id IS
  'Canonical direct cost ledger row for this immutable registry pull snapshot when costed.';
