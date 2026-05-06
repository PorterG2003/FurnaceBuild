-- Replaced lead workflow:
-- - preserve the original lead row for historical attribution
-- - create a new lead row for the replacement contact
-- - move the active enrollment to the new lead so campaign flow continuity stays intact
-- - move pending/reserved jobs and thread ownership to the new lead

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'lead_replacement_status_enum'
  ) THEN
    CREATE TYPE public.lead_replacement_status_enum AS ENUM (
      'suggested',
      'confirmed',
      'completed',
      'cancelled'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'replacement_reason_enum'
  ) THEN
    CREATE TYPE public.replacement_reason_enum AS ENUM (
      'auto_reply_forward',
      'manual_referral',
      'wrong_contact',
      'role_change',
      'other'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.lead_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  campaign_id uuid NULL REFERENCES public.campaigns(id) ON DELETE SET NULL,
  old_lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  new_lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  status public.lead_replacement_status_enum NOT NULL DEFAULT 'completed',
  reason public.replacement_reason_enum NOT NULL,
  reason_note text NULL,
  source_message_id uuid NULL REFERENCES public.email_messages(id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT lead_replacements_old_new_distinct CHECK (old_lead_id <> new_lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_replacements_account_id
  ON public.lead_replacements(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_replacements_old_lead_id
  ON public.lead_replacements(old_lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_replacements_new_lead_id
  ON public.lead_replacements(new_lead_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_replacements_old_lead_active
  ON public.lead_replacements(old_lead_id)
  WHERE status <> 'cancelled';

COMMENT ON TABLE public.lead_replacements IS
  'Tracks when an outreach lead is replaced by a new contact while preserving historical attribution on the original lead.';
COMMENT ON COLUMN public.lead_replacements.reason IS
  'Structured reason for the replacement so UI, analytics, and future automation can interpret the cutover.';
COMMENT ON COLUMN public.lead_replacements.reason_note IS
  'Optional free-text context copied from the reply or entered by the user.';
COMMENT ON COLUMN public.lead_replacements.source_message_id IS
  'Inbox message that prompted the replacement, when applicable.';

ALTER TABLE public.lead_replacements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'lead_replacements'
      AND policyname = 'account_member_select'
  ) THEN
    CREATE POLICY "account_member_select" ON public.lead_replacements
      FOR SELECT
      USING (
        account_id IN (
          SELECT account_users.account_id
          FROM public.account_users
          WHERE account_users.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.replace_lead_with_new_contact(
  p_old_lead_id uuid,
  p_new_email text,
  p_new_name text DEFAULT NULL,
  p_new_first_name text DEFAULT NULL,
  p_new_last_name text DEFAULT NULL,
  p_new_phone_number text DEFAULT NULL,
  p_reason public.replacement_reason_enum DEFAULT 'manual_referral',
  p_reason_note text DEFAULT NULL,
  p_source_message_id uuid DEFAULT NULL
)
RETURNS TABLE (
  replacement_id uuid,
  new_lead_id uuid,
  enrollment_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_lead public.leads%ROWTYPE;
  v_new_lead_id uuid;
  v_replacement_id uuid;
  v_moved_enrollment_id uuid;
  v_now timestamptz := now();
  v_new_email text := NULLIF(lower(trim(p_new_email)), '');
  v_new_name text := NULLIF(trim(p_new_name), '');
  v_new_first_name text := NULLIF(trim(p_new_first_name), '');
  v_new_last_name text := NULLIF(trim(p_new_last_name), '');
  v_new_phone text := NULLIF(trim(p_new_phone_number), '');
BEGIN
  IF p_old_lead_id IS NULL THEN
    RAISE EXCEPTION 'old_lead_id is required';
  END IF;

  IF v_new_email IS NULL THEN
    RAISE EXCEPTION 'new_email is required';
  END IF;

  SELECT *
  INTO v_old_lead
  FROM public.leads
  WHERE id = p_old_lead_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found or already removed';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.account_id = v_old_lead.account_id
        AND au.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lead_replacements lr
    WHERE lr.old_lead_id = v_old_lead.id
      AND lr.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Lead already has a replacement';
  END IF;

  IF v_old_lead.email IS NOT NULL AND lower(trim(v_old_lead.email)) = v_new_email THEN
    RAISE EXCEPTION 'Replacement email must differ from the original lead email';
  END IF;

  IF p_source_message_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.email_messages em
      JOIN public.email_threads et ON et.id = em.thread_id
      WHERE em.id = p_source_message_id
        AND et.account_id = v_old_lead.account_id
    ) THEN
      RAISE EXCEPTION 'source_message_id does not belong to this account';
    END IF;
  END IF;

  INSERT INTO public.leads (
    campaign_id,
    bucket_id,
    account_id,
    email,
    name,
    first_name,
    last_name,
    company_name,
    website,
    linkedin_url,
    company_linkedin_url,
    phone_number,
    source,
    custom_lead_data,
    global_lead_id,
    smartlead_lead_id,
    mailbox_id,
    status,
    deleted_at,
    created_at,
    updated_at
  ) VALUES (
    v_old_lead.campaign_id,
    v_old_lead.bucket_id,
    v_old_lead.account_id,
    v_new_email,
    v_new_name,
    v_new_first_name,
    v_new_last_name,
    v_old_lead.company_name,
    v_old_lead.website,
    v_old_lead.linkedin_url,
    v_old_lead.company_linkedin_url,
    COALESCE(v_new_phone, v_old_lead.phone_number),
    v_old_lead.source,
    v_old_lead.custom_lead_data,
    public.generate_global_lead_id(v_new_email),
    NULL,
    v_old_lead.mailbox_id,
    v_old_lead.status,
    NULL,
    v_now,
    v_now
  )
  RETURNING id INTO v_new_lead_id;

  UPDATE public.enrollments
  SET
    lead_id = v_new_lead_id,
    updated_at = v_now
  WHERE campaign_id = v_old_lead.campaign_id
    AND lead_id = v_old_lead.id
    AND deleted_at IS NULL
  RETURNING id INTO v_moved_enrollment_id;

  UPDATE public.message_jobs
  SET
    lead_id = v_new_lead_id,
    updated_at = v_now
  WHERE lead_id = v_old_lead.id
    AND status IN ('pending', 'reserved');

  UPDATE public.email_threads
  SET
    lead_id = v_new_lead_id,
    participants = CASE
      WHEN v_new_email IS NULL THEN participants
      WHEN participants @> ARRAY[v_new_email]::text[] THEN participants
      ELSE array_append(COALESCE(participants, ARRAY[]::text[]), v_new_email)
    END,
    updated_at = v_now
  WHERE lead_id = v_old_lead.id;

  UPDATE public.leads
  SET
    status = 'removed',
    deleted_at = v_now,
    updated_at = v_now
  WHERE id = v_old_lead.id;

  INSERT INTO public.lead_replacements (
    account_id,
    campaign_id,
    old_lead_id,
    new_lead_id,
    status,
    reason,
    reason_note,
    source_message_id,
    created_by,
    created_at,
    completed_at
  ) VALUES (
    v_old_lead.account_id,
    v_old_lead.campaign_id,
    v_old_lead.id,
    v_new_lead_id,
    'completed',
    p_reason,
    NULLIF(trim(p_reason_note), ''),
    p_source_message_id,
    auth.uid(),
    v_now,
    v_now
  )
  RETURNING id INTO v_replacement_id;

  RETURN QUERY
  SELECT v_replacement_id, v_new_lead_id, v_moved_enrollment_id;
END;
$$;

COMMENT ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) IS
  'Creates a replacement lead, moves the active enrollment to that lead, reassigns pending jobs and thread ownership, and archives the original lead.';

GRANT EXECUTE ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) TO service_role;
