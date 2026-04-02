-- One-off pre-index cleanup: merge duplicate live state_entities rows that share
-- the same (state, registry_entity_id), so the following unique index migration
-- can be applied safely.
--
-- This intentionally leaves registry_source_snapshots untouched.

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

UPDATE entity_owners eo
SET state_entity_id = m.winner_id
FROM tmp_state_entity_duplicate_map m
WHERE eo.state_entity_id = m.loser_id;

UPDATE company_entity_matches cem
SET state_entity_id = m.winner_id
FROM tmp_state_entity_duplicate_map m
WHERE cem.state_entity_id = m.loser_id;

DELETE FROM state_entities se
USING tmp_state_entity_duplicate_map m
WHERE se.id = m.loser_id;
