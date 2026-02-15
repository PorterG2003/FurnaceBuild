-- Thread tags for master inbox: user-defined labels on threads

-- thread_tags: account-level tag definitions
CREATE TABLE IF NOT EXISTS thread_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, name)
);

-- thread_tag_assignments: many-to-many
CREATE TABLE IF NOT EXISTS thread_tag_assignments (
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES thread_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (thread_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_tag_assignments_thread_id ON thread_tag_assignments(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_tag_assignments_tag_id ON thread_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_thread_tags_account_id ON thread_tags(account_id);
