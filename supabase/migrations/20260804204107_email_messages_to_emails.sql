-- Add to_emails for full To recipient lists on email_messages.
-- to_email / to_name remain the primary recipient for reply/job contracts.
-- Also extend message FTS to index to_emails (new function signature).

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS to_emails text[] NULL;

COMMENT ON COLUMN public.email_messages.to_emails IS
  'All To addresses when known. to_email remains the primary/first recipient for reply and job contracts. Sent mail typically stores a single-element array matching to_email.';

-- New overload: PostgreSQL cannot REPLACE a function while changing its argument list.
CREATE OR REPLACE FUNCTION public.build_email_message_search_vector(
  p_subject text,
  p_from_email text,
  p_from_name text,
  p_to_email text,
  p_to_name text,
  p_cc text[],
  p_body_text text,
  p_to_emails text[]
)
RETURNS tsvector
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(p_subject, '')), 'A')
    || setweight(
      to_tsvector(
        'simple',
        coalesce(p_from_email, '') || ' ' ||
        coalesce(p_from_name, '') || ' ' ||
        coalesce(p_to_email, '') || ' ' ||
        coalesce(p_to_name, '') || ' ' ||
        coalesce(array_to_string(p_to_emails, ' '), '') || ' ' ||
        coalesce(array_to_string(p_cc, ' '), '')
      ),
      'B'
    )
    || setweight(to_tsvector('simple', coalesce(left(p_body_text, 50000), '')), 'D');
$$;

CREATE OR REPLACE FUNCTION public.trg_email_messages_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.search_vector := public.build_email_message_search_vector(
    NEW.subject,
    NEW.from_email,
    NEW.from_name,
    NEW.to_email,
    NEW.to_name,
    NEW.cc,
    NEW.body_text,
    NEW.to_emails
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_messages_search_vector_before ON public.email_messages;
CREATE TRIGGER trg_email_messages_search_vector_before
  BEFORE INSERT OR UPDATE OF subject, from_email, from_name, to_email, to_name, to_emails, cc, body_text
  ON public.email_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_email_messages_refresh_search_vector();

GRANT EXECUTE ON FUNCTION public.build_email_message_search_vector(text, text, text, text, text, text[], text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_email_message_search_vector(text, text, text, text, text, text[], text, text[]) TO service_role;

-- Drop the obsolete 7-argument signature after the trigger no longer references it.
DROP FUNCTION IF EXISTS public.build_email_message_search_vector(text, text, text, text, text, text[], text);

UPDATE public.email_messages
SET search_vector = public.build_email_message_search_vector(
  subject, from_email, from_name, to_email, to_name, cc, body_text, to_emails
);
