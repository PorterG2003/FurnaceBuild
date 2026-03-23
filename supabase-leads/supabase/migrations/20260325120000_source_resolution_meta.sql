-- Derived matching fields for source rows (raw_payload stays immutable for CSV snapshot).
ALTER TABLE source_business_records
  ADD COLUMN IF NOT EXISTS resolution_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN source_business_records.resolution_meta IS
  'Normalizer output: normalized_name_key, normalized_domain_key, inferred_state_region, quality_flags, normalizer_version, normalized_at.';

CREATE INDEX IF NOT EXISTS idx_source_business_records_res_name_key
  ON source_business_records ((resolution_meta->>'normalized_name_key'))
  WHERE (resolution_meta->>'normalized_name_key') IS NOT NULL;
