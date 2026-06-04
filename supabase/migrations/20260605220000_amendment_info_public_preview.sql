-- Allow unauthenticated users to load limited amendment info on the accept page
-- (mirrors get_invitation_info / get_platform_invitation_info).

CREATE OR REPLACE FUNCTION public.get_platform_account_amendment_info(p_amendment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_amendment public.platform_account_amendments%ROWTYPE;
  v_revision public.platform_account_amendment_revisions%ROWTYPE;
  v_billing public.account_billing%ROWTYPE;
BEGIN
  SELECT * INTO v_amendment FROM public.platform_account_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_amendment.status <> 'pending_acceptance' THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = v_amendment.id
    AND revision_number = COALESCE(v_amendment.published_revision_number, v_amendment.current_revision_number);

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'pending_acceptance',
      'amendment_id', v_amendment.id,
      'account_name', v_revision.account_name
    );
  END IF;

  IF NOT public.is_account_owner(v_amendment.account_id, v_uid)
     AND NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_billing FROM public.account_billing WHERE account_id = v_amendment.account_id;

  RETURN jsonb_build_object(
    'status', 'pending_acceptance',
    'amendment_id', v_amendment.id,
    'account_id', v_amendment.account_id,
    'account_name', v_revision.account_name,
    'current_monthly_retainer_cents', v_billing.monthly_retainer_cents,
    'proposed_monthly_retainer_cents', v_revision.monthly_retainer_cents,
    'currency', v_revision.currency,
    'proposal_snapshot_json', v_revision.proposal_snapshot_json,
    'agreement_type', v_revision.agreement_type,
    'terms_version', v_revision.terms_version,
    'terms_snapshot_markdown', v_revision.terms_snapshot_markdown,
    'published_revision_number', v_amendment.published_revision_number,
    'published_at', v_amendment.published_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_account_amendment_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_platform_account_amendment_info(UUID) TO authenticated;
