-- ============================================
-- Platform invite revision system: unpublish/restore, safe draft saves, status normalization
-- ============================================

UPDATE public.platform_invitations
SET status = 'sent', updated_at = now()
WHERE status = 'pending';

UPDATE public.platform_invitations
SET status = 'draft', updated_at = now()
WHERE status = 'approved';

ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_status_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_status_check
  CHECK (
    status IN (
      'draft',
      'sent',
      'pending_payment',
      'active',
      'expired',
      'revoked'
    )
  );

DROP INDEX IF EXISTS idx_platform_invitations_open_email;

CREATE UNIQUE INDEX idx_platform_invitations_open_email
  ON public.platform_invitations (lower(email))
  WHERE status IN ('draft', 'sent', 'pending_payment');

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
    status = CASE
      WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.status
      ELSE 'draft'
    END,
    approved_at = CASE
      WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.approved_at
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_invitation_id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_platform_invitation(p_invitation_id UUID)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.platform_invitations
  SET
    published_revision_number = NULL,
    checkout_revision_number = NULL,
    status = 'draft',
    approved_at = NULL,
    updated_at = now()
  WHERE id = p_invitation_id
    AND status IN ('draft', 'sent')
    AND published_revision_number IS NOT NULL
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or cannot be unpublished';
  END IF;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_platform_invitation_revision(
  p_invitation_id UUID,
  p_revision_number INTEGER
)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv public.platform_invitations%ROWTYPE;
  v_source public.platform_invitation_revisions%ROWTYPE;
  v_next_revision INTEGER;
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

  SELECT * INTO v_source
  FROM public.platform_invitation_revisions
  WHERE invitation_id = p_invitation_id
    AND revision_number = p_revision_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision not found';
  END IF;

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
    v_source.email,
    v_source.proposed_account_name,
    v_source.monthly_retainer_cents,
    v_source.currency,
    v_source.first_month_discount_cents,
    v_source.proposal_snapshot_json,
    v_source.agreement_type,
    v_source.terms_version,
    v_source.terms_source_markdown,
    v_source.terms_snapshot_markdown,
    v_uid,
    now()
  );

  UPDATE public.platform_invitations
  SET
    email = v_source.email,
    proposed_account_name = v_source.proposed_account_name,
    monthly_retainer_cents = v_source.monthly_retainer_cents,
    currency = v_source.currency,
    first_month_discount_cents = v_source.first_month_discount_cents,
    proposal_snapshot_json = v_source.proposal_snapshot_json,
    agreement_type = v_source.agreement_type,
    terms_version = v_source.terms_version,
    terms_source_markdown = v_source.terms_source_markdown,
    terms_snapshot_markdown = v_source.terms_snapshot_markdown,
    current_revision_number = v_next_revision,
    status = CASE
      WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.status
      ELSE 'draft'
    END,
    approved_at = CASE
      WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.approved_at
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_invitation_id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_platform_invitation_ready(p_invitation_id UUID)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.platform_invitations
  SET
    approved_at = now(),
    updated_at = now()
  WHERE id = p_invitation_id
    AND status IN ('draft', 'sent')
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or cannot be marked ready';
  END IF;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_platform_invitation(p_invitation_id UUID)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.platform_invitations
  SET
    status = 'sent',
    published_revision_number = current_revision_number,
    checkout_revision_number = NULL,
    approved_at = COALESCE(approved_at, now()),
    sent_at = COALESCE(sent_at, now()),
    last_email_sent_at = now(),
    updated_at = now()
  WHERE id = p_invitation_id
    AND status IN ('draft', 'sent')
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or cannot be published';
  END IF;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_invitation(
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
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  v_inv := public.create_platform_invitation_draft(
    p_email,
    p_proposed_account_name,
    p_monthly_retainer_cents,
    p_currency,
    p_first_month_discount_cents,
    p_proposal_snapshot_json,
    p_terms_version,
    p_auto_add_internal_admins,
    p_expires_at,
    p_agreement_type,
    p_terms_source_markdown
  );

  UPDATE public.platform_invitations
  SET
    status = 'sent',
    published_revision_number = current_revision_number,
    approved_at = now(),
    sent_at = now(),
    last_email_sent_at = now(),
    updated_at = now()
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_invitation_info(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_revision RECORD;
  v_status TEXT;
  v_live_revision_number INTEGER;
BEGIN
  UPDATE public.platform_invitations
  SET viewed_at = COALESCE(viewed_at, now())
  WHERE id = p_invitation_id
    AND viewed_at IS NULL;

  SELECT
    pi.*,
    COALESCE(NULLIF(u.name, ''), u.email) AS inviter_name
  INTO v_inv
  FROM public.platform_invitations pi
  JOIN public.users u ON u.id = pi.invited_by_user_id
  WHERE pi.id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_status := v_inv.status;
  IF v_status IN ('draft', 'sent')
     AND v_inv.expires_at IS NOT NULL
     AND v_inv.expires_at < now() THEN
    UPDATE public.platform_invitations
    SET status = 'expired',
        updated_at = now()
    WHERE id = p_invitation_id
      AND status IN ('draft', 'sent');
    v_status := 'expired';
  END IF;

  IF v_status = 'revoked' THEN
    RETURN jsonb_build_object('status', 'revoked');
  END IF;

  IF v_status = 'expired' THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF v_status = 'draft' OR v_inv.published_revision_number IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_live_revision_number := CASE
    WHEN v_status = 'active' THEN COALESCE(v_inv.accepted_revision_number, v_inv.published_revision_number, v_inv.current_revision_number)
    WHEN v_status = 'pending_payment' THEN COALESCE(v_inv.checkout_revision_number, v_inv.published_revision_number)
    ELSE v_inv.published_revision_number
  END;

  IF v_live_revision_number IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT
    pir.email,
    pir.proposed_account_name,
    pir.monthly_retainer_cents,
    pir.currency,
    pir.first_month_discount_cents,
    pir.proposal_snapshot_json,
    pir.agreement_type,
    pir.terms_version,
    pir.terms_source_markdown,
    pir.terms_snapshot_markdown
  INTO v_revision
  FROM public.platform_invitation_revisions pir
  WHERE pir.invitation_id = p_invitation_id
    AND pir.revision_number = v_live_revision_number;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'invitee_email', v_revision.email,
    'expires_at', v_inv.expires_at,
    'proposed_account_name', v_revision.proposed_account_name,
    'monthly_retainer_cents', v_revision.monthly_retainer_cents,
    'currency', v_revision.currency,
    'first_month_discount_cents', v_revision.first_month_discount_cents,
    'proposal_snapshot', COALESCE(v_revision.proposal_snapshot_json, '{}'::jsonb),
    'agreement_type', v_revision.agreement_type,
    'terms_version', v_revision.terms_version,
    'terms_source_markdown', v_revision.terms_source_markdown,
    'terms_snapshot_markdown', v_revision.terms_snapshot_markdown,
    'inviter_name', v_inv.inviter_name,
    'viewed_at', v_inv.viewed_at,
    'published_revision_number', v_inv.published_revision_number,
    'active_revision_number', v_live_revision_number,
    'selected_payment_route', v_inv.selected_payment_route,
    'selected_payment_route_fee_cents', v_inv.selected_payment_route_fee_cents,
    'selected_payment_subtotal_cents', v_inv.selected_payment_subtotal_cents,
    'selected_payment_total_cents', v_inv.selected_payment_total_cents,
    'recurring_anchor_at', v_inv.recurring_anchor_at,
    'first_recurring_invoice_target_cents', v_inv.first_recurring_invoice_target_cents
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_account_management_records()
RETURNS TABLE (
  record_kind TEXT,
  record_id UUID,
  invitation_id UUID,
  account_id UUID,
  lifecycle_status TEXT,
  revision_state TEXT,
  display_name TEXT,
  primary_email TEXT,
  monthly_retainer_cents INTEGER,
  billing_status TEXT,
  current_revision_number INTEGER,
  published_revision_number INTEGER,
  accepted_revision_number INTEGER,
  sent_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    'invitation'::TEXT AS record_kind,
    pi.id AS record_id,
    pi.id AS invitation_id,
    pi.created_account_id AS account_id,
    CASE
      WHEN pi.status IN ('draft', 'sent')
        AND pi.expires_at IS NOT NULL
        AND pi.expires_at < now()
      THEN 'expired'
      ELSE pi.status
    END AS lifecycle_status,
    CASE
      WHEN pi.accepted_revision_number IS NOT NULL
        THEN format('Accepted v%s', pi.accepted_revision_number)
      WHEN pi.published_revision_number IS NULL
        THEN format('Draft v%s', pi.current_revision_number)
      WHEN pi.current_revision_number = pi.published_revision_number
        THEN format('Live v%s', pi.current_revision_number)
      ELSE format('Live v%s / Draft v%s', pi.published_revision_number, pi.current_revision_number)
    END AS revision_state,
    COALESCE(
      NULLIF(pi.prepared_account_name, ''),
      NULLIF(pi.proposed_account_name, ''),
      NULLIF(a.name, ''),
      split_part(pi.email, '@', 1)
    ) AS display_name,
    pi.email AS primary_email,
    COALESCE(ab.monthly_retainer_cents, pi.monthly_retainer_cents) AS monthly_retainer_cents,
    ab.billing_status,
    pi.current_revision_number,
    pi.published_revision_number,
    pi.accepted_revision_number,
    pi.sent_at,
    COALESCE(pi.payment_completed_at, pi.last_email_sent_at, pi.updated_at) AS last_activity_at,
    pi.updated_at
  FROM public.platform_invitations pi
  LEFT JOIN public.accounts a ON a.id = pi.created_account_id
  LEFT JOIN public.account_billing ab ON ab.account_id = pi.created_account_id

  UNION ALL

  SELECT
    'account'::TEXT AS record_kind,
    a.id AS record_id,
    NULL::UUID AS invitation_id,
    a.id AS account_id,
    'active'::TEXT AS lifecycle_status,
    'Legacy account'::TEXT AS revision_state,
    a.name AS display_name,
    owner.email AS primary_email,
    ab.monthly_retainer_cents,
    ab.billing_status,
    NULL::INTEGER AS current_revision_number,
    NULL::INTEGER AS published_revision_number,
    NULL::INTEGER AS accepted_revision_number,
    NULL::TIMESTAMPTZ AS sent_at,
    COALESCE(ab.updated_at, a.updated_at) AS last_activity_at,
    COALESCE(ab.updated_at, a.updated_at) AS updated_at
  FROM public.accounts a
  JOIN public.account_billing ab ON ab.account_id = a.id
  LEFT JOIN LATERAL (
    SELECT u.email
    FROM public.account_users au
    JOIN public.users u ON u.id = au.user_id
    WHERE au.account_id = a.id
    ORDER BY au.is_owner DESC, au.created_at ASC
    LIMIT 1
  ) owner ON true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.platform_invitations pi
    WHERE pi.created_account_id = a.id
  )

  ORDER BY updated_at DESC, last_activity_at DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_invitations()
RETURNS TABLE (
  id UUID,
  email TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  proposed_account_name TEXT,
  monthly_retainer_cents INTEGER,
  currency TEXT,
  first_month_discount_cents INTEGER,
  terms_version TEXT,
  created_account_id UUID,
  invited_by_user_name TEXT,
  accepted_by_user_name TEXT,
  current_revision_number INTEGER,
  published_revision_number INTEGER,
  accepted_revision_number INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    pi.id,
    pi.email,
    CASE
      WHEN pi.status IN ('draft', 'sent')
        AND pi.expires_at IS NOT NULL
        AND pi.expires_at < now()
      THEN 'expired'
      ELSE pi.status
    END AS status,
    pi.expires_at,
    pi.viewed_at,
    pi.proposed_account_name,
    pi.monthly_retainer_cents,
    pi.currency,
    pi.first_month_discount_cents,
    pi.terms_version,
    pi.created_account_id,
    COALESCE(NULLIF(inviter.name, ''), inviter.email) AS invited_by_user_name,
    COALESCE(NULLIF(invitee.name, ''), invitee.email) AS accepted_by_user_name,
    pi.current_revision_number,
    pi.published_revision_number,
    pi.accepted_revision_number,
    pi.created_at,
    pi.updated_at,
    pi.completed_at
  FROM public.platform_invitations pi
  JOIN public.users inviter ON inviter.id = pi.invited_by_user_id
  LEFT JOIN public.users invitee ON invitee.id = pi.accepted_by_user_id
  ORDER BY pi.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_platform_invitation_checkout(
  p_invitation_id UUID,
  p_full_name TEXT,
  p_account_name TEXT,
  p_terms_accepted_ip TEXT DEFAULT NULL
)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(email) INTO v_email
  FROM auth.users
  WHERE id = v_uid;

  UPDATE public.platform_invitations
  SET accepted_by_user_id = v_uid,
      prepared_full_name = NULLIF(trim(COALESCE(p_full_name, '')), ''),
      prepared_account_name = NULLIF(trim(COALESCE(p_account_name, '')), ''),
      terms_accepted_at = now(),
      terms_accepted_ip = COALESCE(p_terms_accepted_ip, terms_accepted_ip),
      checkout_revision_number = COALESCE(published_revision_number, current_revision_number),
      status = 'pending_payment',
      updated_at = now()
  WHERE id = p_invitation_id
    AND lower(email) = COALESCE(v_email, '')
    AND COALESCE(published_revision_number, current_revision_number) IS NOT NULL
    AND status IN ('sent', 'pending_payment')
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or email mismatch';
  END IF;

  IF v_inv.prepared_full_name IS NULL OR v_inv.prepared_account_name IS NULL THEN
    RAISE EXCEPTION 'Full name and account name are required';
  END IF;

  UPDATE public.users
  SET name = v_inv.prepared_full_name,
      updated_at = now()
  WHERE id = v_uid;

  RETURN v_inv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unpublish_platform_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_platform_invitation_revision(UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
