-- Store error details when enrollment is stopped due to scheduler/processing error
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS stopped_error_message TEXT;

COMMENT ON COLUMN enrollments.stopped_error_message IS 'Error message or details when stopped_reason = ''error''; gives clue to what/where/why.';
