-- Scalable queue count for import pipeline cards.
-- Avoids loading all source_business_records IDs into the API Lambda.

CREATE INDEX idx_review_tasks_source_record_pending_entity
  ON review_tasks (entity_id)
  WHERE entity_type = 'source_business_record'
    AND status = 'pending';

CREATE OR REPLACE FUNCTION get_ingestion_run_queue_pending_tasks(run_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM review_tasks rt
  INNER JOIN source_business_records sbr
    ON sbr.id = rt.entity_id
  WHERE sbr.ingestion_run_id = run_id
    AND rt.entity_type = 'source_business_record'
    AND rt.status = 'pending';
$$;
