CREATE OR REPLACE FUNCTION public.assert_platform_invitation_email_available(
  p_email TEXT,
  p_excluded_invitation_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
BEGIN
  IF v_email = '' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.platform_invitations pi
    WHERE lower(pi.email) = v_email
      AND pi.status = 'active'
      AND (p_excluded_invitation_id IS NULL OR pi.id <> p_excluded_invitation_id)
  ) THEN
    RAISE EXCEPTION 'This email already belongs to an active client account. Open the existing account instead of creating a new invite.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_platform_invitation_email_available(TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_platform_invitation_draft(
  p_email TEXT,
  p_proposed_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
  p_first_month_discount_cents INTEGER DEFAULT 0,
  p_proposal_snapshot_json JSONB DEFAULT '{}'::jsonb,
  p_terms_version TEXT DEFAULT NULL,
  p_auto_add_internal_admins BOOLEAN DEFAULT true,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_agreement_type TEXT DEFAULT NULL,
  p_terms_source_markdown TEXT DEFAULT NULL
)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_terms public.platform_terms_versions%ROWTYPE;
  v_inv public.platform_invitations%ROWTYPE;
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_agreement_type TEXT := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed_services_agreement'
    ELSE 'platform_agreement'
  END;
  v_terms_source_markdown TEXT;
  v_terms_snapshot_markdown TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  PERFORM public.assert_platform_invitation_email_available(v_email);

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
  END IF;

  IF COALESCE(p_terms_version, '') = '' THEN
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE agreement_type = v_agreement_type
      AND is_default = true
    ORDER BY effective_at DESC
    LIMIT 1;
  ELSE
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE version = p_terms_version;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terms version not found';
  END IF;

  v_agreement_type := v_terms.agreement_type;
  v_terms_source_markdown := COALESCE(NULLIF(p_terms_source_markdown, ''), v_terms.body_markdown);
  v_terms_snapshot_markdown := public.render_platform_terms_markdown(
    v_terms_source_markdown,
    p_proposed_account_name,
    p_monthly_retainer_cents,
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    now()
  );

  INSERT INTO public.platform_invitations (
    email,
    invited_by_user_id,
    status,
    proposed_account_name,
    monthly_retainer_cents,
    currency,
    first_month_discount_cents,
    proposal_snapshot_json,
    agreement_type,
    terms_version,
    terms_source_markdown,
    terms_snapshot_markdown,
    auto_add_internal_admins,
    expires_at,
    current_revision_number
  )
  VALUES (
    v_email,
    v_uid,
    'draft',
    NULLIF(trim(COALESCE(p_proposed_account_name, '')), ''),
    p_monthly_retainer_cents,
    lower(trim(COALESCE(p_currency, 'usd'))),
    GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    v_agreement_type,
    v_terms.version,
    v_terms_source_markdown,
    v_terms_snapshot_markdown,
    COALESCE(p_auto_add_internal_admins, true),
    p_expires_at,
    1
  )
  RETURNING * INTO v_inv;

  INSERT INTO public.platform_invitation_revisions (
    invitation_id,
    revision_number,
    email,
    proposed_account_name,
    monthly_retainer_cents,
    currency,
    first_month_discount_cents,
    proposal_snapshot_json,
    agreement_type,
    terms_version,
    terms_source_markdown,
    terms_snapshot_markdown,
    created_by_user_id,
    created_at
  )
  VALUES (
    v_inv.id,
    1,
    v_inv.email,
    v_inv.proposed_account_name,
    v_inv.monthly_retainer_cents,
    v_inv.currency,
    v_inv.first_month_discount_cents,
    v_inv.proposal_snapshot_json,
    v_inv.agreement_type,
    v_inv.terms_version,
    v_inv.terms_source_markdown,
    v_inv.terms_snapshot_markdown,
    v_uid,
    now()
  );

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_platform_invitation_draft(
  p_invitation_id UUID,
  p_email TEXT,
  p_proposed_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
  p_first_month_discount_cents INTEGER DEFAULT 0,
  p_proposal_snapshot_json JSONB DEFAULT '{}'::jsonb,
  p_terms_version TEXT DEFAULT NULL,
  p_auto_add_internal_admins BOOLEAN DEFAULT true,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_agreement_type TEXT DEFAULT NULL,
  p_terms_source_markdown TEXT DEFAULT NULL
)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_terms public.platform_terms_versions%ROWTYPE;
  v_inv public.platform_invitations%ROWTYPE;
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_next_revision INTEGER;
  v_agreement_type TEXT;
  v_terms_source_markdown TEXT;
  v_terms_snapshot_markdown TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_inv
  FROM public.platform_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF v_inv.status IN ('pending_payment', 'active', 'revoked', 'expired') THEN
    RAISE EXCEPTION 'Invitation can no longer be edited';
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  PERFORM public.assert_platform_invitation_email_available(v_email, p_invitation_id);

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
  END IF;

  v_agreement_type := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed_services_agreement'
    WHEN p_agreement_type = 'platform_agreement' THEN 'platform_agreement'
    ELSE COALESCE(v_inv.agreement_type, 'platform_agreement')
  END;

  IF COALESCE(p_terms_version, '') = '' THEN
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE agreement_type = v_agreement_type
      AND is_default = true
    ORDER BY effective_at DESC
    LIMIT 1;
  ELSE
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE version = p_terms_version;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terms version not found';
  END IF;

  v_agreement_type := v_terms.agreement_type;
  v_terms_source_markdown := COALESCE(NULLIF(p_terms_source_markdown, ''), v_terms.body_markdown);
  v_terms_snapshot_markdown := public.render_platform_terms_markdown(
    v_terms_source_markdown,
    p_proposed_account_name,
    p_monthly_retainer_cents,
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    now()
  );

  v_next_revision := COALESCE(v_inv.current_revision_number, 0) + 1;

  INSERT INTO public.platform_invitation_revisions (
    invitation_id,
    revision_number,
    email,
    proposed_account_name,
    monthly_retainer_cents,
    currency,
    first_month_discount_cents,
    proposal_snapshot_json,
    agreement_type,
    terms_version,
    terms_source_markdown,
    terms_snapshot_markdown,
    created_by_user_id,
    created_at
  )
  VALUES (
    v_inv.id,
    v_next_revision,
    v_email,
    NULLIF(trim(COALESCE(p_proposed_account_name, '')), ''),
    p_monthly_retainer_cents,
    lower(trim(COALESCE(p_currency, 'usd'))),
    GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    v_agreement_type,
    v_terms.version,
    v_terms_source_markdown,
    v_terms_snapshot_markdown,
    v_uid,
    now()
  );

  UPDATE public.platform_invitations
  SET
    email = v_email,
    proposed_account_name = NULLIF(trim(COALESCE(p_proposed_account_name, '')), ''),
    monthly_retainer_cents = p_monthly_retainer_cents,
    currency = lower(trim(COALESCE(p_currency, 'usd'))),
    first_month_discount_cents = GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    proposal_snapshot_json = COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    agreement_type = v_agreement_type,
    terms_version = v_terms.version,
    terms_source_markdown = v_terms_source_markdown,
    terms_snapshot_markdown = v_terms_snapshot_markdown,
    auto_add_internal_admins = COALESCE(p_auto_add_internal_admins, true),
    expires_at = p_expires_at,
    current_revision_number = v_next_revision,
    status = 'draft',
    approved_at = NULL,
    updated_at = now()
  WHERE id = p_invitation_id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;
