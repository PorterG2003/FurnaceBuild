-- Richer location signals for reconciliation; lean owner fields before a future people table.

ALTER TABLE company_locations
  ADD COLUMN normalized_address_key TEXT,
  ADD COLUMN latitude DOUBLE PRECISION,
  ADD COLUMN longitude DOUBLE PRECISION,
  ADD COLUMN source_type TEXT,
  ADD COLUMN address_confidence NUMERIC(5, 4),
  ADD COLUMN deliverability_status TEXT,
  ADD COLUMN address_hash TEXT;

CREATE INDEX idx_company_locations_normalized_address_key
  ON company_locations (normalized_address_key)
  WHERE normalized_address_key IS NOT NULL;

ALTER TABLE entity_owners
  ADD COLUMN owner_normalized_key TEXT,
  ADD COLUMN first_name TEXT,
  ADD COLUMN last_name TEXT,
  ADD COLUMN parse_confidence NUMERIC(5, 4),
  ADD COLUMN parse_quality SMALLINT;

CREATE INDEX idx_entity_owners_owner_normalized_key
  ON entity_owners (owner_normalized_key)
  WHERE owner_normalized_key IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_archive_company_location_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM company_location_history
  WHERE company_location_id = OLD.id;

  INSERT INTO company_location_history (company_location_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'company_id', OLD.company_id,
      'line1', OLD.line1,
      'line2', OLD.line2,
      'city', OLD.city,
      'state_region', OLD.state_region,
      'postal_code', OLD.postal_code,
      'country', OLD.country,
      'is_primary', OLD.is_primary,
      'normalized_address_key', OLD.normalized_address_key,
      'latitude', OLD.latitude,
      'longitude', OLD.longitude,
      'source_type', OLD.source_type,
      'address_confidence', OLD.address_confidence,
      'deliverability_status', OLD.deliverability_status,
      'address_hash', OLD.address_hash,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_archive_entity_owner_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM entity_owner_history
  WHERE entity_owner_id = OLD.id;

  INSERT INTO entity_owner_history (entity_owner_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'state_entity_id', OLD.state_entity_id,
      'source_snapshot_id', OLD.source_snapshot_id,
      'owner_name', OLD.owner_name,
      'title_role', OLD.title_role,
      'effective_at', OLD.effective_at,
      'ended_at', OLD.ended_at,
      'observed_at', OLD.observed_at,
      'is_current', OLD.is_current,
      'owner_normalized_key', OLD.owner_normalized_key,
      'first_name', OLD.first_name,
      'last_name', OLD.last_name,
      'parse_confidence', OLD.parse_confidence,
      'parse_quality', OLD.parse_quality,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;
