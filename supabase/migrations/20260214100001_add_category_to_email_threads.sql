-- Thread categorization for master inbox

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS category_source TEXT CHECK (category_source IN ('user', 'system', 'ai'));

COMMENT ON COLUMN email_threads.category IS 'User- or system-defined category e.g. Lead replied, Meeting set';
COMMENT ON COLUMN email_threads.category_source IS 'Who set the category: user, system, or ai';
