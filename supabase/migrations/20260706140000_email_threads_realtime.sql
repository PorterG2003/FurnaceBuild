-- Enable Realtime for open-conversation count badges (postgres_changes on email_threads).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'email_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE email_threads;
  END IF;
END $$;
