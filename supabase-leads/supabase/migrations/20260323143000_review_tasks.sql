-- Manual QA / adjudication queue for Foundry admin.

CREATE TABLE review_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_to UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT review_tasks_entity_type_check CHECK (
    entity_type IN (
      'source_business_record',
      'company',
      'company_entity_match',
      'source_business_company_link'
    )
  ),
  CONSTRAINT review_tasks_status_check CHECK (
    status IN ('pending', 'in_progress', 'resolved', 'cancelled')
  )
);

CREATE INDEX idx_review_tasks_queue
  ON review_tasks (status, priority DESC, created_at);

CREATE INDEX idx_review_tasks_assignee
  ON review_tasks (assigned_to, status)
  WHERE assigned_to IS NOT NULL;

COMMENT ON TABLE review_tasks IS 'Human review queue for ambiguous matches, duplicates, and bad parses.';

ALTER TABLE review_tasks ENABLE ROW LEVEL SECURITY;
