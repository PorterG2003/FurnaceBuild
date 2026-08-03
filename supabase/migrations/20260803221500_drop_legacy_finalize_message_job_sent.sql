-- The threading migration added a 4-arg finalize_message_job_sent. On databases
-- that already had the 3-arg version, PostgreSQL kept both overloads. Drop the
-- legacy signature so PostgREST resolves a single function.
DROP FUNCTION IF EXISTS public.finalize_message_job_sent(UUID, TEXT, TIMESTAMPTZ);
