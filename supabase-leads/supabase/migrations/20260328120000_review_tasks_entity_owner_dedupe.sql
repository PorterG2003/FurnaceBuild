-- Allow entity_owner dedupe queue items (contacts / registry owners).

ALTER TABLE review_tasks DROP CONSTRAINT IF EXISTS review_tasks_task_type_check;

ALTER TABLE review_tasks
  ADD CONSTRAINT review_tasks_task_type_check
  CHECK (task_type IN (
    'source_link_review',
    'company_dedupe',
    'entity_owner_dedupe',
    'entity_match_review',
    'parse_failure'
  ));

COMMENT ON CONSTRAINT review_tasks_task_type_check ON review_tasks IS
  'Allowed: source_link_review, company_dedupe, entity_owner_dedupe, entity_match_review, parse_failure.';

ALTER TABLE review_tasks DROP CONSTRAINT IF EXISTS review_tasks_entity_type_check;

ALTER TABLE review_tasks
  ADD CONSTRAINT review_tasks_entity_type_check
  CHECK (entity_type IN (
    'source_business_record',
    'company',
    'entity_owner',
    'company_entity_match',
    'source_business_company_link'
  ));

COMMENT ON CONSTRAINT review_tasks_entity_type_check ON review_tasks IS
  'Polymorphic entity pointer; includes entity_owner for owner/contact dedupe.';
