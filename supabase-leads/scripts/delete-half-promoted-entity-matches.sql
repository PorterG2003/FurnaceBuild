-- One-off: remove ~50% of current PROMOTED company↔state registry matches so state
-- matching can run again for those companies (see loadPromotedMatchKeys in stateMatching.ts).
--
-- Run in the Foundry LEADS Supabase project (SQL Editor), as postgres or service role.
-- Preview first:
--   SELECT COUNT(*) FROM company_entity_matches
--   WHERE is_current = true AND match_status = 'promoted';
--
-- Related rows: company_entity_match_history CASCADE-deletes with the match row;
-- reconciliation_results.company_entity_match_id is SET NULL on delete.

BEGIN;

WITH half AS (
  SELECT id
  FROM company_entity_matches
  WHERE is_current = true
    AND match_status = 'promoted'
  ORDER BY id
  LIMIT (
    SELECT GREATEST(0, COUNT(*) / 2)
    FROM company_entity_matches
    WHERE is_current = true
      AND match_status = 'promoted'
  )
),
del_tasks AS (
  DELETE FROM review_tasks rt
  USING half h
  WHERE rt.entity_type = 'company_entity_match'
    AND rt.entity_id = h.id
  RETURNING rt.id
)
DELETE FROM company_entity_matches m
USING half h
WHERE m.id = h.id;

COMMIT;

-- For a random ~half instead of deterministic (first half by id), replace both
-- `ORDER BY id` in the half CTE with `ORDER BY random()`.
