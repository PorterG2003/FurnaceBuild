-- Refresh current_* views so SELECT * re-expands after new columns (registry_state, owner parse fields).
-- Enforce pipeline vocabularies; one final linked row per source_business_record; tighten anon/authenticated grants.

-- ---------------------------------------------------------------------------
-- 1. Views (security_invoker — same as 20260322180000)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW current_entity_owners
WITH (security_invoker = true)
AS
SELECT *
FROM entity_owners
WHERE is_current = true;

CREATE OR REPLACE VIEW current_company_entity_matches
WITH (security_invoker = true)
AS
SELECT *
FROM company_entity_matches
WHERE is_current = true;

COMMENT ON VIEW current_entity_owners IS 'Owners with is_current = true; prefer append+close updates on entity_owners.';
COMMENT ON VIEW current_company_entity_matches IS 'Match rows with is_current = true.';

-- ---------------------------------------------------------------------------
-- 2. CHECK constraints (agreed literals)
-- ---------------------------------------------------------------------------

ALTER TABLE source_business_company_links
  ADD CONSTRAINT source_business_company_links_link_status_check
  CHECK (link_status IN ('candidate', 'linked', 'rejected'));

ALTER TABLE reconciliation_results
  ADD CONSTRAINT reconciliation_results_outcome_check
  CHECK (outcome IN ('matched', 'no_match', 'ambiguous', 'error'));

ALTER TABLE review_tasks
  ADD CONSTRAINT review_tasks_task_type_check
  CHECK (task_type IN (
    'source_link_review',
    'company_dedupe',
    'entity_match_review',
    'parse_failure'
  ));

COMMENT ON CONSTRAINT source_business_company_links_link_status_check ON source_business_company_links IS
  'Allowed: candidate (multi company ok), linked (at most one current per source row), rejected.';
COMMENT ON CONSTRAINT reconciliation_results_outcome_check ON reconciliation_results IS
  'Allowed: matched, no_match, ambiguous, error.';
COMMENT ON CONSTRAINT review_tasks_task_type_check ON review_tasks IS
  'Allowed: source_link_review, company_dedupe, entity_match_review, parse_failure.';
COMMENT ON CONSTRAINT company_entity_matches_status_check ON company_entity_matches IS
  'Allowed: candidate, promoted, rejected.';

-- ---------------------------------------------------------------------------
-- 3. At most one current "linked" row per source_business_record
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX uniq_source_business_one_linked_current
  ON source_business_company_links (source_business_record_id)
  WHERE is_current = true AND link_status = 'linked';

-- ---------------------------------------------------------------------------
-- 4. Revoke broad privileges from API roles (service_role bypasses RLS)
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
