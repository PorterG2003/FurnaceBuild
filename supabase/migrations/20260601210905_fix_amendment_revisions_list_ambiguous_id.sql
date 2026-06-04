-- Fix list_platform_account_amendment_revisions: RETURNS TABLE column names
-- (especially "id") shadow table columns and cause "column reference id is ambiguous".
CREATE OR REPLACE FUNCTION public.list_platform_account_amendment_revisions(p_amendment_id UUID)
RETURNS TABLE (
  id UUID,
  amendment_id UUID,
  revision_number INTEGER,
  account_name TEXT,
  monthly_retainer_cents INTEGER,
  currency TEXT,
  proposal_snapshot_json JSONB,
  agreement_type TEXT,
  terms_version TEXT,
  terms_snapshot_markdown TEXT,
  created_by_user_id UUID,
  created_by_user_name TEXT,
  created_at TIMESTAMPTZ,
  is_current BOOLEAN,
  is_published BOOLEAN,
  is_accepted BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_amendment public.platform_account_amendments%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_amendment FROM public.platform_account_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.amendment_id,
    r.revision_number,
    r.account_name,
    r.monthly_retainer_cents,
    r.currency,
    r.proposal_snapshot_json,
    r.agreement_type,
    r.terms_version,
    r.terms_snapshot_markdown,
    r.created_by_user_id,
    COALESCE(NULLIF(u.name, ''), u.email, '') AS created_by_user_name,
    r.created_at,
    (r.revision_number = v_amendment.current_revision_number) AS is_current,
    COALESCE(r.revision_number = v_amendment.published_revision_number, false) AS is_published,
    COALESCE(r.revision_number = v_amendment.accepted_revision_number, false) AS is_accepted
  FROM public.platform_account_amendment_revisions r
  JOIN public.users u ON u.id = r.created_by_user_id
  WHERE r.amendment_id = p_amendment_id
  ORDER BY r.revision_number DESC;
END;
$$;
