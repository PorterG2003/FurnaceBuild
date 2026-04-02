-- Smart ambiguity: company context on targets, audit metadata on attempts, review queue integration.

ALTER TABLE contact_enrichment_targets
  ADD COLUMN IF NOT EXISTS company_legal_name TEXT;

COMMENT ON COLUMN contact_enrichment_targets.company_legal_name IS
  'Company legal name at enrichment time; used for employer/signal scoring (not part of lookup fingerprint).';

ALTER TABLE contact_enrichment_attempts
  ADD COLUMN IF NOT EXISTS decision_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS matcher_version TEXT,
  ADD COLUMN IF NOT EXISTS scoring_version TEXT,
  ADD COLUMN IF NOT EXISTS ruleset_version TEXT,
  ADD COLUMN IF NOT EXISTS ruleset_preset TEXT,
  ADD COLUMN IF NOT EXISTS review_task_id UUID;

COMMENT ON COLUMN contact_enrichment_attempts.decision_metadata IS
  'Ranked candidates, reason codes, and explainability payload for tuning rulesets.';

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_attempts_review_task
  ON contact_enrichment_attempts (review_task_id)
  WHERE review_task_id IS NOT NULL;

ALTER TABLE review_tasks DROP CONSTRAINT IF EXISTS review_tasks_task_type_check;

ALTER TABLE review_tasks
  ADD CONSTRAINT review_tasks_task_type_check
  CHECK (task_type IN (
    'source_link_review',
    'company_dedupe',
    'entity_owner_dedupe',
    'entity_match_review',
    'parse_failure',
    'contact_enrichment_review'
  ));

COMMENT ON CONSTRAINT review_tasks_task_type_check ON review_tasks IS
  'Allowed: source_link_review, company_dedupe, entity_owner_dedupe, entity_match_review, parse_failure, contact_enrichment_review.';

ALTER TABLE review_tasks DROP CONSTRAINT IF EXISTS review_tasks_entity_type_check;

ALTER TABLE review_tasks
  ADD CONSTRAINT review_tasks_entity_type_check
  CHECK (entity_type IN (
    'source_business_record',
    'company',
    'entity_owner',
    'company_entity_match',
    'source_business_company_link',
    'contact_enrichment_attempt'
  ));

COMMENT ON CONSTRAINT review_tasks_entity_type_check ON review_tasks IS
  'Polymorphic entity pointer; contact_enrichment_attempt links human review to a specific enrichment attempt.';

ALTER TABLE contact_enrichment_attempts
  ADD CONSTRAINT contact_enrichment_attempts_review_task_fk
  FOREIGN KEY (review_task_id) REFERENCES review_tasks(id) ON DELETE SET NULL;

-- ON DELETE SET NULL keeps historical attempts if a review row is removed.
