-- Guard inbox reply ingestion against duplicate thread/message creation.
-- These indexes intentionally fail fast if historical duplicates still exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM email_threads
    WHERE message_job_id IS NOT NULL
    GROUP BY message_job_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add unique inbox thread constraint: duplicate email_threads.message_job_id rows still exist. Clean them up before applying 20260411160000_add_inbox_thread_message_uniqueness.sql.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_threads_message_job_id_unique
  ON email_threads (message_job_id)
  WHERE message_job_id IS NOT NULL;

DROP INDEX IF EXISTS idx_email_threads_message_job_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM email_messages
    WHERE message_id IS NOT NULL
    GROUP BY account_id, message_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add unique inbox message constraint: duplicate email_messages(account_id, message_id) rows still exist. Clean them up before applying 20260411160000_add_inbox_thread_message_uniqueness.sql.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_account_message_id_unique
  ON email_messages (account_id, message_id)
  WHERE message_id IS NOT NULL;

DROP INDEX IF EXISTS idx_email_messages_message_id;
