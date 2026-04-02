-- Denormalized registry state for matching integrity: at most one current promoted match per (company, state).
ALTER TABLE company_entity_matches
  ADD COLUMN registry_state TEXT;

UPDATE company_entity_matches m
SET registry_state = e.state
FROM state_entities e
WHERE e.id = m.state_entity_id;

ALTER TABLE company_entity_matches
  ALTER COLUMN registry_state SET NOT NULL;

CREATE OR REPLACE FUNCTION trg_company_entity_matches_set_registry_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  st TEXT;
BEGIN
  SELECT se.state INTO st
  FROM state_entities se
  WHERE se.id = NEW.state_entity_id;

  IF st IS NULL THEN
    RAISE EXCEPTION 'state_entities row not found for state_entity_id=%', NEW.state_entity_id;
  END IF;

  NEW.registry_state := st;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_entity_matches_registry_state
  BEFORE INSERT OR UPDATE ON company_entity_matches
  FOR EACH ROW
  EXECUTE FUNCTION trg_company_entity_matches_set_registry_state();

CREATE UNIQUE INDEX uniq_current_promoted_match_per_company_state
  ON company_entity_matches (company_id, registry_state)
  WHERE is_current = true AND match_status = 'promoted';

CREATE OR REPLACE FUNCTION trg_archive_company_entity_match_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_ver INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_ver
  FROM company_entity_match_history
  WHERE company_entity_match_id = OLD.id;

  INSERT INTO company_entity_match_history (company_entity_match_id, version_number, changed_at, snapshot)
  VALUES (
    OLD.id,
    next_ver,
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'id', OLD.id,
      'company_id', OLD.company_id,
      'state_entity_id', OLD.state_entity_id,
      'registry_state', OLD.registry_state,
      'match_score', OLD.match_score,
      'match_status', OLD.match_status,
      'matcher_version', OLD.matcher_version,
      'scoring_version', OLD.scoring_version,
      'ruleset_version', OLD.ruleset_version,
      'is_current', OLD.is_current,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at
    ))
  );
  RETURN NEW;
END;
$$;
