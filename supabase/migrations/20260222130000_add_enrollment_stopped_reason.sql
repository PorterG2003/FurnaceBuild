-- Add stopped_reason and stopped_at to enrollments (meaningful when state = 'stopped')
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS stopped_reason TEXT,
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;

ALTER TABLE enrollments
  DROP CONSTRAINT IF EXISTS enrollments_stopped_reason_check;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_stopped_reason_check
  CHECK (stopped_reason IS NULL OR stopped_reason IN ('replied', 'bounced', 'unsubscribed', 'error'));

COMMENT ON COLUMN enrollments.stopped_reason IS 'Why the enrollment was stopped; only meaningful when state = ''stopped''.';
COMMENT ON COLUMN enrollments.stopped_at IS 'When the enrollment was stopped; only meaningful when state = ''stopped''.';

-- Optional backfill: set stopped_reason from events for existing stopped enrollments
UPDATE enrollments e
SET
  stopped_reason = sub.reason,
  stopped_at = COALESCE(e.stopped_at, sub.created_at)
FROM (
  SELECT DISTINCT ON (enrollment_id)
    enrollment_id,
    event_type AS reason,
    created_at
  FROM events
  WHERE enrollment_id IS NOT NULL
    AND event_type IN ('replied', 'bounced')
  ORDER BY enrollment_id, created_at DESC
) sub
WHERE e.id = sub.enrollment_id
  AND e.state = 'stopped'
  AND e.stopped_reason IS NULL;
