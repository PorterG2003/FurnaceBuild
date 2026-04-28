ALTER TABLE company_website_intelligence
  ADD COLUMN IF NOT EXISTS cost_record_id UUID REFERENCES cost_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_status TEXT NOT NULL DEFAULT 'pre_cost_implementation_or_not_backfilled';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_website_intelligence_cost_status_check'
  ) THEN
    ALTER TABLE company_website_intelligence
      ADD CONSTRAINT company_website_intelligence_cost_status_check CHECK (
        cost_status IN ('costed', 'failed_or_not_costed', 'pre_cost_implementation_or_not_backfilled')
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_website_intelligence_cost_record
  ON company_website_intelligence (cost_record_id)
  WHERE cost_record_id IS NOT NULL;

COMMENT ON COLUMN company_website_intelligence.cost_record_id IS
  'Direct canonical cost_records row for the OpenRouter Website Intelligence LLM call, when costed.';

COMMENT ON COLUMN company_website_intelligence.cost_status IS
  'Cost linkage status: costed, failed_or_not_costed, or pre_cost_implementation_or_not_backfilled.';

WITH priced_intelligence AS (
  SELECT
    wi.id,
    wi.company_id,
    wi.source_ingestion_run_id,
    wi.foundry_job_id,
    wi.model,
    wi.generated_at,
    wi.created_at,
    wi.llm_usage,
    ROUND(((wi.llm_usage->>'cost')::numeric) * 1000000)::bigint AS cost_amount_micros,
    COALESCE(
      CASE
        WHEN (wi.llm_usage->>'total_tokens') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN FLOOR((wi.llm_usage->>'total_tokens')::numeric)::bigint
        ELSE NULL
      END,
      (
        COALESCE(
          CASE
            WHEN (wi.llm_usage->>'prompt_tokens') ~ '^[0-9]+(\.[0-9]+)?$'
              THEN FLOOR((wi.llm_usage->>'prompt_tokens')::numeric)::bigint
            ELSE NULL
          END,
          0
        )
        + COALESCE(
          CASE
            WHEN (wi.llm_usage->>'completion_tokens') ~ '^[0-9]+(\.[0-9]+)?$'
              THEN FLOOR((wi.llm_usage->>'completion_tokens')::numeric)::bigint
            ELSE NULL
          END,
          0
        )
      ),
      0
    ) AS usage_quantity
  FROM company_website_intelligence wi
  WHERE wi.cost_record_id IS NULL
    AND wi.llm_status = 'completed'
    AND (wi.llm_usage->>'cost') ~ '^[0-9]+(\.[0-9]+)?$'
    AND (wi.llm_usage->>'cost')::numeric >= 0
),
upserted_cost_records AS (
  INSERT INTO cost_records (
    created_at,
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
    meta
  )
  SELECT
    COALESCE(pi.generated_at, pi.created_at, now()),
    'enrichment',
    'openrouter',
    'website_intelligence_llm',
    GREATEST(pi.usage_quantity, 0),
    'token',
    GREATEST(pi.cost_amount_micros, 0),
    'USD',
    NULL,
    false,
    'direct',
    'vendor_direct',
    'company_website_intelligence',
    pi.id,
    pi.company_id,
    pi.source_ingestion_run_id,
    pi.foundry_job_id,
    jsonb_build_object(
      'model', pi.model,
      'prompt_tokens', CASE
        WHEN (pi.llm_usage->>'prompt_tokens') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN FLOOR((pi.llm_usage->>'prompt_tokens')::numeric)::bigint
        ELSE NULL
      END,
      'completion_tokens', CASE
        WHEN (pi.llm_usage->>'completion_tokens') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN FLOOR((pi.llm_usage->>'completion_tokens')::numeric)::bigint
        ELSE NULL
      END,
      'total_tokens', pi.usage_quantity,
      'openrouter_cost_usd', (pi.llm_usage->>'cost')::numeric
    )
  FROM priced_intelligence pi
  ON CONFLICT (source_entity_type, source_entity_id) WHERE record_kind = 'direct'
  DO UPDATE SET
    usage_quantity = EXCLUDED.usage_quantity,
    usage_unit = EXCLUDED.usage_unit,
    cost_amount_micros = EXCLUDED.cost_amount_micros,
    cost_rate_card_id = NULL,
    cost_is_override = false,
    estimation_kind = 'vendor_direct',
    company_id = EXCLUDED.company_id,
    ingestion_run_id = EXCLUDED.ingestion_run_id,
    foundry_job_id = EXCLUDED.foundry_job_id,
    meta = EXCLUDED.meta
  RETURNING id, source_entity_id
)
UPDATE company_website_intelligence wi
SET
  cost_record_id = ucr.id,
  cost_status = 'costed'
FROM upserted_cost_records ucr
WHERE wi.id = ucr.source_entity_id;

UPDATE company_website_intelligence
SET cost_status = 'failed_or_not_costed'
WHERE cost_record_id IS NULL
  AND (
    llm_status IN ('failed', 'skipped', 'not_run')
    OR (
      llm_status = 'completed'
      AND NOT (
        (llm_usage->>'cost') ~ '^[0-9]+(\.[0-9]+)?$'
        AND (llm_usage->>'cost')::numeric >= 0
      )
    )
  );
