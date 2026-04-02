-- One-off: merge duplicate live state_entities rows that share the same
-- (state, registry_entity_id), so a unique index on that key can be added.
--
-- Run in the Foundry LEADS Supabase project (SQL Editor), as postgres or service role.
--
-- Why this exists:
-- - historical worker behavior inserted duplicate live state_entities rows
-- - the new current-row model needs one live row per (state, registry_entity_id)
--
-- What this script does:
-- 1. Finds duplicate clusters by (state, registry_entity_id) where registry_entity_id IS NOT NULL.
-- 2. Picks one survivor per cluster using a deterministic ranking:
--    promoted current match count DESC,
--    current match count DESC,
--    current owner count DESC,
--    updated_at DESC,
--    created_at DESC,
--    id DESC
-- 3. Repoints dependent live rows to the survivor:
--    - entity_owners.state_entity_id
--    - company_entity_matches.state_entity_id
-- 4. Copies loser state_entity_history rows onto the survivor with new version_numbers.
-- 5. Deletes loser state_entities rows.
--
-- Notes:
-- - registry_source_snapshots are left untouched; they remain the immutable evidence layer.
-- - entity_owners / company_entity_matches updates will create their own *_history rows
--   via existing BEFORE UPDATE triggers.
-- - copied state_entity_history snapshots retain the original loser row id in snapshot JSON
--   and add merge metadata so provenance is not lost.
-- - this script does NOT dedupe owner rows or match rows that become logically redundant
--   after repointing; it only normalizes state_entities enough to support uniqueness.
--
-- Recommended workflow:
-- 1. Run the preview queries below.
-- 2. Run this script inside a transaction.
-- 3. Verify the post-check queries at the bottom.
-- 4. Then re-run the migration / CREATE UNIQUE INDEX step.
--
-- Preview duplicate scope:
-- SELECT
--   state,
--   registry_entity_id,
--   COUNT(*) AS row_count,
--   ARRAY_AGG(id ORDER BY updated_at DESC, created_at DESC, id DESC) AS state_entity_ids
-- FROM state_entities
-- WHERE registry_entity_id IS NOT NULL
-- GROUP BY state, registry_entity_id
-- HAVING COUNT(*) > 1
-- ORDER BY row_count DESC, state, registry_entity_id;
--
-- Preview the survivor/loser mapping this script would use:
-- WITH entity_stats AS (
--   SELECT
--     se.id,
--     se.state,
--     se.registry_entity_id,
--     se.legal_name,
--     se.created_at,
--     se.updated_at,
--     COUNT(DISTINCT eo.id) FILTER (WHERE eo.is_current = true) AS current_owner_count,
--     COUNT(DISTINCT cem.id) FILTER (WHERE cem.is_current = true) AS current_match_count,
--     COUNT(DISTINCT cem.id) FILTER (
--       WHERE cem.is_current = true AND cem.match_status = 'promoted'
--     ) AS current_promoted_match_count
--   FROM state_entities se
--   LEFT JOIN entity_owners eo ON eo.state_entity_id = se.id
--   LEFT JOIN company_entity_matches cem ON cem.state_entity_id = se.id
--   WHERE se.registry_entity_id IS NOT NULL
--   GROUP BY se.id, se.state, se.registry_entity_id, se.legal_name, se.created_at, se.updated_at
-- ),
-- ranked AS (
--   SELECT
--     es.*,
--     ROW_NUMBER() OVER (
--       PARTITION BY es.state, es.registry_entity_id
--       ORDER BY
--         es.current_promoted_match_count DESC,
--         es.current_match_count DESC,
--         es.current_owner_count DESC,
--         es.updated_at DESC,
--         es.created_at DESC,
--         es.id DESC
--     ) AS survivor_rank
--   FROM entity_stats es
--   JOIN (
--     SELECT state, registry_entity_id
--     FROM entity_stats
--     GROUP BY state, registry_entity_id
--     HAVING COUNT(*) > 1
--   ) dup USING (state, registry_entity_id)
-- )
-- SELECT
--   state,
--   registry_entity_id,
--   MAX(CASE WHEN survivor_rank = 1 THEN id END) AS winner_id,
--   ARRAY_AGG(id ORDER BY survivor_rank) FILTER (WHERE survivor_rank > 1) AS loser_ids
-- FROM ranked
-- GROUP BY state, registry_entity_id
-- ORDER BY state, registry_entity_id;

BEGIN;

CREATE TEMP TABLE tmp_state_entity_duplicate_ranked ON COMMIT DROP AS
WITH entity_stats AS (
  SELECT
    se.id,
    se.state,
    se.registry_entity_id,
    se.legal_name,
    se.source_snapshot_id,
    se.created_at,
    se.updated_at,
    COUNT(DISTINCT eo.id) FILTER (WHERE eo.is_current = true) AS current_owner_count,
    COUNT(DISTINCT cem.id) FILTER (WHERE cem.is_current = true) AS current_match_count,
    COUNT(DISTINCT cem.id) FILTER (
      WHERE cem.is_current = true AND cem.match_status = 'promoted'
    ) AS current_promoted_match_count
  FROM state_entities se
  LEFT JOIN entity_owners eo ON eo.state_entity_id = se.id
  LEFT JOIN company_entity_matches cem ON cem.state_entity_id = se.id
  WHERE se.registry_entity_id IS NOT NULL
  GROUP BY
    se.id,
    se.state,
    se.registry_entity_id,
    se.legal_name,
    se.source_snapshot_id,
    se.created_at,
    se.updated_at
),
duplicate_clusters AS (
  SELECT state, registry_entity_id
  FROM entity_stats
  GROUP BY state, registry_entity_id
  HAVING COUNT(*) > 1
)
SELECT
  es.*,
  ROW_NUMBER() OVER (
    PARTITION BY es.state, es.registry_entity_id
    ORDER BY
      es.current_promoted_match_count DESC,
      es.current_match_count DESC,
      es.current_owner_count DESC,
      es.updated_at DESC,
      es.created_at DESC,
      es.id DESC
  ) AS survivor_rank
FROM entity_stats es
JOIN duplicate_clusters dc
  ON dc.state = es.state
 AND dc.registry_entity_id = es.registry_entity_id;

CREATE TEMP TABLE tmp_state_entity_duplicate_map ON COMMIT DROP AS
SELECT
  losers.state,
  losers.registry_entity_id,
  winners.id AS winner_id,
  losers.id AS loser_id
FROM tmp_state_entity_duplicate_ranked winners
JOIN tmp_state_entity_duplicate_ranked losers
  ON losers.state = winners.state
 AND losers.registry_entity_id = winners.registry_entity_id
WHERE winners.survivor_rank = 1
  AND losers.survivor_rank > 1;

-- Copy loser history rows onto the winner before deleting losers.
CREATE TEMP TABLE tmp_state_entity_history_to_insert ON COMMIT DROP AS
WITH winner_existing_history AS (
  SELECT
    state_entity_id,
    COALESCE(MAX(version_number), 0) AS max_version
  FROM state_entity_history
  GROUP BY state_entity_id
),
loser_history_ranked AS (
  SELECT
    m.winner_id,
    m.loser_id,
    h.changed_at,
    h.changed_by,
    COALESCE(
      h.change_reason,
      format('merged duplicate state_entity_id %s into survivor %s', m.loser_id, m.winner_id)
    ) AS change_reason,
    CASE
      WHEN jsonb_typeof(h.snapshot) = 'object' THEN
        h.snapshot || jsonb_build_object(
          'merged_from_state_entity_id', m.loser_id::text,
          'merged_into_state_entity_id', m.winner_id::text
        )
      ELSE
        h.snapshot
    END AS snapshot,
    ROW_NUMBER() OVER (
      PARTITION BY m.winner_id
      ORDER BY h.changed_at, h.version_number, h.id
    ) AS winner_seq
  FROM tmp_state_entity_duplicate_map m
  JOIN state_entity_history h
    ON h.state_entity_id = m.loser_id
)
SELECT
  lhr.winner_id AS state_entity_id,
  COALESCE(weh.max_version, 0) + lhr.winner_seq AS version_number,
  lhr.changed_at,
  lhr.changed_by,
  lhr.change_reason,
  lhr.snapshot
FROM loser_history_ranked lhr
LEFT JOIN winner_existing_history weh
  ON weh.state_entity_id = lhr.winner_id;

INSERT INTO state_entity_history (
  state_entity_id,
  version_number,
  changed_at,
  changed_by,
  change_reason,
  snapshot
)
SELECT
  state_entity_id,
  version_number,
  changed_at,
  changed_by,
  change_reason,
  snapshot
FROM tmp_state_entity_history_to_insert;

-- Repoint live dependents to the survivor.
UPDATE entity_owners eo
SET state_entity_id = m.winner_id
FROM tmp_state_entity_duplicate_map m
WHERE eo.state_entity_id = m.loser_id;

UPDATE company_entity_matches cem
SET state_entity_id = m.winner_id
FROM tmp_state_entity_duplicate_map m
WHERE cem.state_entity_id = m.loser_id;

-- Delete loser state_entities rows. CASCADE removes loser state_entity_history rows,
-- which is why loser history was copied first.
DELETE FROM state_entities se
USING tmp_state_entity_duplicate_map m
WHERE se.id = m.loser_id;

COMMIT;

-- Post-check: there should now be zero duplicate clusters for non-null registry ids.
-- SELECT
--   state,
--   registry_entity_id,
--   COUNT(*) AS row_count
-- FROM state_entities
-- WHERE registry_entity_id IS NOT NULL
-- GROUP BY state, registry_entity_id
-- HAVING COUNT(*) > 1
-- ORDER BY row_count DESC, state, registry_entity_id;
--
-- Post-check: if this returns rows, inspect whether merged owners now need cleanup.
-- SELECT
--   state_entity_id,
--   owner_normalized_key,
--   COUNT(*) AS current_row_count
-- FROM entity_owners
-- WHERE is_current = true
--   AND owner_normalized_key IS NOT NULL
-- GROUP BY state_entity_id, owner_normalized_key
-- HAVING COUNT(*) > 1
-- ORDER BY current_row_count DESC, state_entity_id;
