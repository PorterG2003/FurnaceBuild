ALTER TABLE entity_owners
  ADD COLUMN owner_kind TEXT,
  ADD COLUMN resolution_status TEXT,
  ADD COLUMN resolved_state_entity_id UUID REFERENCES state_entities (id) ON DELETE SET NULL,
  ADD COLUMN discovery_depth SMALLINT,
  ADD COLUMN resolution_notes JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_entity_owners_resolved_state_entity_id
  ON entity_owners (resolved_state_entity_id)
  WHERE resolved_state_entity_id IS NOT NULL;

CREATE INDEX idx_entity_owners_resolution_status
  ON entity_owners (resolution_status)
  WHERE resolution_status IS NOT NULL;

CREATE UNIQUE INDEX uniq_state_entities_state_registry_entity_id
  ON state_entities (state, registry_entity_id)
  WHERE registry_entity_id IS NOT NULL;

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
      'owner_kind', OLD.owner_kind,
      'resolution_status', OLD.resolution_status,
      'resolved_state_entity_id', OLD.resolved_state_entity_id,
      'discovery_depth', OLD.discovery_depth,
      'resolution_notes', OLD.resolution_notes,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;
