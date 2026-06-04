-- ============================================
-- Remove platform invite first-month discount schema
-- ============================================

ALTER TABLE public.platform_invitation_revisions
  DROP COLUMN IF EXISTS first_month_discount_cents;

ALTER TABLE public.platform_invitations
  DROP COLUMN IF EXISTS first_month_discount_cents;

DROP FUNCTION IF EXISTS public.create_platform_invitation_draft(
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  JSONB,
  TEXT,
  BOOLEAN,
  TIMESTAMPTZ,
  TEXT,
  TEXT
);

DROP FUNCTION IF EXISTS public.update_platform_invitation_draft(
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  JSONB,
  TEXT,
  BOOLEAN,
  TIMESTAMPTZ,
  TEXT,
  TEXT
);

DROP FUNCTION IF EXISTS public.create_platform_invitation(
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  JSONB,
  TEXT,
  BOOLEAN,
  TIMESTAMPTZ,
  TEXT,
  TEXT
);

CREATE OR REPLACE FUNCTION public.create_platform_invitation_draft(
  p_email TEXT,
  p_proposed_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
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

  PERFORM public.assert_platform_invitation_email_available(v_email, NULL);

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
    proposal_snapshot_json = COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    agreement_type = v_agreement_type,
    terms_version = v_terms.version,
    terms_source_markdown = v_terms_source_markdown,
    terms_snapshot_markdown = v_terms_snapshot_markdown,
    auto_add_internal_admins = COALESCE(p_auto_add_internal_admins, true),
    expires_at = p_expires_at,
    current_revision_number = v_next_revision,
    status = CASE WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.status ELSE 'draft' END,
    approved_at = CASE WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.approved_at ELSE NULL END,
    updated_at = now()
  WHERE id = p_invitation_id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_invitation(
  p_email TEXT,
  p_proposed_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
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
    proposal_snapshot_json = v_source.proposal_snapshot_json,
    agreement_type = v_source.agreement_type,
    terms_version = v_source.terms_version,
    terms_source_markdown = v_source.terms_source_markdown,
    terms_snapshot_markdown = v_source.terms_snapshot_markdown,
    current_revision_number = v_next_revision,
    status = CASE WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.status ELSE 'draft' END,
    approved_at = CASE WHEN v_inv.published_revision_number IS NOT NULL THEN v_inv.approved_at ELSE NULL END,
    updated_at = now()
  WHERE id = p_invitation_id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

DROP FUNCTION IF EXISTS public.list_platform_invitation_revisions(UUID);

CREATE OR REPLACE FUNCTION public.list_platform_invitation_revisions(p_invitation_id UUID)
RETURNS TABLE (
  id UUID,
  revision_number INTEGER,
  email TEXT,
  proposed_account_name TEXT,
  monthly_retainer_cents INTEGER,
  currency TEXT,
  proposal_snapshot_json JSONB,
  agreement_type TEXT,
  terms_version TEXT,
  terms_source_markdown TEXT,
  terms_snapshot_markdown TEXT,
  created_by_user_id UUID,
  created_by_user_name TEXT,
  created_at TIMESTAMPTZ,
  is_current BOOLEAN,
  is_published BOOLEAN,
  is_checkout BOOLEAN,
  is_accepted BOOLEAN
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
    pir.id,
    pir.revision_number,
    pir.email,
    pir.proposed_account_name,
    pir.monthly_retainer_cents,
    pir.currency,
    pir.proposal_snapshot_json,
    pir.agreement_type,
    pir.terms_version,
    pir.terms_source_markdown,
    pir.terms_snapshot_markdown,
    pir.created_by_user_id,
    COALESCE(NULLIF(u.name, ''), u.email) AS created_by_user_name,
    pir.created_at,
    pir.revision_number = pi.current_revision_number AS is_current,
    pir.revision_number = pi.published_revision_number AS is_published,
    pir.revision_number = pi.checkout_revision_number AS is_checkout,
    pir.revision_number = pi.accepted_revision_number AS is_accepted
  FROM public.platform_invitation_revisions pir
  JOIN public.platform_invitations pi ON pi.id = pir.invitation_id
  JOIN public.users u ON u.id = pir.created_by_user_id
  WHERE pir.invitation_id = p_invitation_id
  ORDER BY pir.revision_number DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.list_platform_invitations();

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
      WHEN pi.status IN ('draft', 'sent') AND pi.expires_at IS NOT NULL AND pi.expires_at < now()
        THEN 'expired'
      ELSE pi.status
    END AS status,
    pi.expires_at,
    pi.viewed_at,
    pi.proposed_account_name,
    pi.monthly_retainer_cents,
    pi.currency,
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
  IF v_status IN ('draft', 'sent') AND v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
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
    WHEN v_status = 'active'
      THEN COALESCE(v_inv.accepted_revision_number, v_inv.published_revision_number, v_inv.current_revision_number)
    WHEN v_status = 'pending_payment'
      THEN COALESCE(v_inv.checkout_revision_number, v_inv.published_revision_number)
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

CREATE OR REPLACE FUNCTION public.get_platform_account_management_detail(
  p_record_id UUID,
  p_record_kind TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_account RECORD;
  v_billing JSONB := NULL;
  v_adjustments JSONB := '[]'::jsonb;
  v_team_members JSONB := '[]'::jsonb;
  v_revisions JSONB := '[]'::jsonb;
  v_source_invitation JSONB := NULL;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_record_kind = 'invitation' THEN
    SELECT
      pi.*,
      COALESCE(NULLIF(inviter.name, ''), inviter.email) AS invited_by_user_name,
      COALESCE(NULLIF(invitee.name, ''), invitee.email) AS accepted_by_user_name
    INTO v_inv
    FROM public.platform_invitations pi
    JOIN public.users inviter ON inviter.id = pi.invited_by_user_id
    LEFT JOIN public.users invitee ON invitee.id = pi.accepted_by_user_id
    WHERE pi.id = p_record_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invitation not found';
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(rev) ORDER BY rev.revision_number DESC), '[]'::jsonb)
    INTO v_revisions
    FROM public.list_platform_invitation_revisions(v_inv.id) rev;

    IF v_inv.created_account_id IS NOT NULL THEN
      SELECT a.* INTO v_account
      FROM public.accounts a
      WHERE a.id = v_inv.created_account_id;

      SELECT to_jsonb(ab.*) INTO v_billing
      FROM public.account_billing ab
      WHERE ab.account_id = v_inv.created_account_id;

      SELECT COALESCE(jsonb_agg(to_jsonb(ba) ORDER BY ba.billing_year DESC, ba.billing_month DESC, ba.created_at DESC), '[]'::jsonb)
      INTO v_adjustments
      FROM public.billing_adjustments ba
      WHERE ba.account_id = v_inv.created_account_id;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'membership_id', au.id,
            'user_id', u.id,
            'name', u.name,
            'email', u.email,
            'role', au.role,
            'is_owner', au.is_owner,
            'created_at', au.created_at
          )
          ORDER BY au.is_owner DESC, au.created_at ASC
        ),
        '[]'::jsonb
      )
      INTO v_team_members
      FROM public.account_users au
      JOIN public.users u ON u.id = au.user_id
      WHERE au.account_id = v_inv.created_account_id;
    END IF;

    RETURN jsonb_build_object(
      'record_kind', 'invitation',
      'invitation', jsonb_build_object(
        'id', v_inv.id,
        'email', v_inv.email,
        'status', v_inv.status,
        'expires_at', v_inv.expires_at,
        'viewed_at', v_inv.viewed_at,
        'proposed_account_name', v_inv.proposed_account_name,
        'monthly_retainer_cents', v_inv.monthly_retainer_cents,
        'currency', v_inv.currency,
        'proposal_snapshot_json', v_inv.proposal_snapshot_json,
        'terms_version', v_inv.terms_version,
        'terms_snapshot_markdown', v_inv.terms_snapshot_markdown,
        'auto_add_internal_admins', v_inv.auto_add_internal_admins,
        'current_revision_number', v_inv.current_revision_number,
        'published_revision_number', v_inv.published_revision_number,
        'checkout_revision_number', v_inv.checkout_revision_number,
        'accepted_revision_number', v_inv.accepted_revision_number,
        'approved_at', v_inv.approved_at,
        'sent_at', v_inv.sent_at,
        'last_email_sent_at', v_inv.last_email_sent_at,
        'selected_payment_route', v_inv.selected_payment_route,
        'selected_payment_route_fee_cents', v_inv.selected_payment_route_fee_cents,
        'selected_payment_subtotal_cents', v_inv.selected_payment_subtotal_cents,
        'selected_payment_total_cents', v_inv.selected_payment_total_cents,
        'upfront_stripe_invoice_id', v_inv.upfront_stripe_invoice_id,
        'upfront_stripe_payment_intent_id', v_inv.upfront_stripe_payment_intent_id,
        'recurring_anchor_at', v_inv.recurring_anchor_at,
        'first_recurring_invoice_target_cents', v_inv.first_recurring_invoice_target_cents,
        'first_recurring_coupon_id', v_inv.first_recurring_coupon_id,
        'prepared_full_name', v_inv.prepared_full_name,
        'prepared_account_name', v_inv.prepared_account_name,
        'terms_accepted_at', v_inv.terms_accepted_at,
        'payment_completed_at', v_inv.payment_completed_at,
        'created_account_id', v_inv.created_account_id,
        'invited_by_user_name', v_inv.invited_by_user_name,
        'accepted_by_user_name', v_inv.accepted_by_user_name,
        'created_at', v_inv.created_at,
        'updated_at', v_inv.updated_at
      ),
      'account', CASE WHEN v_account IS NULL THEN NULL ELSE to_jsonb(v_account) END,
      'billing', v_billing,
      'adjustments', v_adjustments,
      'team_members', v_team_members,
      'revisions', v_revisions
    );
  ELSIF p_record_kind = 'account' THEN
    SELECT
      a.*,
      owner.user_id AS owner_user_id,
      owner.email AS owner_email,
      owner.name AS owner_name
    INTO v_account
    FROM public.accounts a
    LEFT JOIN LATERAL (
      SELECT u.id AS user_id, u.email, u.name
      FROM public.account_users au
      JOIN public.users u ON u.id = au.user_id
      WHERE au.account_id = a.id
      ORDER BY au.is_owner DESC, au.created_at ASC
      LIMIT 1
    ) owner ON true
    WHERE a.id = p_record_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account not found';
    END IF;

    SELECT to_jsonb(ab.*) INTO v_billing
    FROM public.account_billing ab
    WHERE ab.account_id = v_account.id;

    SELECT COALESCE(jsonb_agg(to_jsonb(ba) ORDER BY ba.billing_year DESC, ba.billing_month DESC, ba.created_at DESC), '[]'::jsonb)
    INTO v_adjustments
    FROM public.billing_adjustments ba
    WHERE ba.account_id = v_account.id;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'membership_id', au.id,
          'user_id', u.id,
          'name', u.name,
          'email', u.email,
          'role', au.role,
          'is_owner', au.is_owner,
          'created_at', au.created_at
        )
        ORDER BY au.is_owner DESC, au.created_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_team_members
    FROM public.account_users au
    JOIN public.users u ON u.id = au.user_id
    WHERE au.account_id = v_account.id;

    SELECT jsonb_build_object(
      'id', pi.id,
      'email', pi.email,
      'status', pi.status,
      'current_revision_number', pi.current_revision_number,
      'published_revision_number', pi.published_revision_number,
      'accepted_revision_number', pi.accepted_revision_number,
      'selected_payment_route', pi.selected_payment_route,
      'selected_payment_route_fee_cents', pi.selected_payment_route_fee_cents,
      'selected_payment_subtotal_cents', pi.selected_payment_subtotal_cents,
      'selected_payment_total_cents', pi.selected_payment_total_cents,
      'upfront_stripe_invoice_id', pi.upfront_stripe_invoice_id,
      'upfront_stripe_payment_intent_id', pi.upfront_stripe_payment_intent_id,
      'recurring_anchor_at', pi.recurring_anchor_at,
      'first_recurring_invoice_target_cents', pi.first_recurring_invoice_target_cents,
      'first_recurring_coupon_id', pi.first_recurring_coupon_id,
      'created_at', pi.created_at,
      'updated_at', pi.updated_at
    )
    INTO v_source_invitation
    FROM public.platform_invitations pi
    WHERE pi.created_account_id = v_account.id
    ORDER BY pi.created_at DESC
    LIMIT 1;

    IF v_source_invitation IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(rev) ORDER BY rev.revision_number DESC), '[]'::jsonb)
      INTO v_revisions
      FROM public.list_platform_invitation_revisions((v_source_invitation->>'id')::uuid) rev;
    END IF;

    RETURN jsonb_build_object(
      'record_kind', 'account',
      'account', jsonb_build_object(
        'id', v_account.id,
        'name', v_account.name,
        'owner_user_id', v_account.owner_user_id,
        'owner_name', v_account.owner_name,
        'owner_email', v_account.owner_email,
        'created_at', v_account.created_at,
        'updated_at', v_account.updated_at
      ),
      'billing', v_billing,
      'adjustments', v_adjustments,
      'team_members', v_team_members,
      'source_invitation', v_source_invitation,
      'revisions', v_revisions
    );
  ELSE
    RAISE EXCEPTION 'Unsupported record kind';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_platform_invitation(
  p_invitation_id UUID,
  p_stripe_customer_id TEXT,
  p_stripe_subscription_id TEXT,
  p_stripe_checkout_session_id TEXT,
  p_internal_admin_emails TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_inv public.platform_invitations%ROWTYPE;
  v_revision public.platform_invitation_revisions%ROWTYPE;
  v_account_id UUID;
  v_internal_email TEXT;
  v_internal_user_id UUID;
  v_effective_revision_number INTEGER;
BEGIN
  SELECT * INTO v_inv
  FROM public.platform_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  IF v_inv.created_account_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_completed', 'account_id', v_inv.created_account_id);
  END IF;
  IF v_inv.accepted_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Invitation has not been prepared for checkout';
  END IF;
  IF v_inv.terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'Terms must be accepted before completion';
  END IF;

  v_effective_revision_number := COALESCE(
    v_inv.checkout_revision_number,
    v_inv.published_revision_number,
    v_inv.current_revision_number
  );

  SELECT * INTO v_revision
  FROM public.platform_invitation_revisions
  WHERE invitation_id = p_invitation_id
    AND revision_number = v_effective_revision_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation revision not found';
  END IF;

  INSERT INTO public.accounts (name, created_at, updated_at)
  VALUES (
    COALESCE(
      v_inv.prepared_account_name,
      v_revision.proposed_account_name,
      split_part(v_revision.email, '@', 1) || '''s Account'
    ),
    now(),
    now()
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.account_users (account_id, user_id, is_owner, role, created_at, updated_at)
  VALUES (v_account_id, v_inv.accepted_by_user_id, true, 'owner', now(), now())
  ON CONFLICT (account_id, user_id) DO NOTHING;

  INSERT INTO public.account_billing (
    account_id,
    stripe_customer_id,
    stripe_subscription_id,
    monthly_retainer_cents,
    billing_status,
    billing_anchor_day,
    agreement_type,
    proposal_snapshot_json,
    terms_version,
    terms_snapshot_markdown
  )
  VALUES (
    v_account_id,
    NULLIF(trim(COALESCE(p_stripe_customer_id, '')), ''),
    NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), ''),
    v_revision.monthly_retainer_cents,
    'active',
    1,
    v_revision.agreement_type,
    v_revision.proposal_snapshot_json,
    v_revision.terms_version,
    v_revision.terms_snapshot_markdown
  )
  ON CONFLICT (account_id) DO NOTHING;

  IF v_inv.auto_add_internal_admins THEN
    FOREACH v_internal_email IN ARRAY p_internal_admin_emails
    LOOP
      SELECT id INTO v_internal_user_id
      FROM auth.users
      WHERE lower(email) = lower(v_internal_email)
      LIMIT 1;

      IF v_internal_user_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.users (id, email, name, created_at, updated_at)
      SELECT au.id, lower(au.email), COALESCE(au.raw_user_meta_data->>'name', ''), now(), now()
      FROM auth.users au
      WHERE au.id = v_internal_user_id
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.account_users (account_id, user_id, is_owner, role, created_at, updated_at)
      VALUES (v_account_id, v_internal_user_id, false, 'admin', now(), now())
      ON CONFLICT (account_id, user_id) DO NOTHING;
    END LOOP;
  END IF;

  UPDATE public.platform_invitations
  SET status = 'active',
      created_account_id = v_account_id,
      email = v_revision.email,
      proposed_account_name = v_revision.proposed_account_name,
      monthly_retainer_cents = v_revision.monthly_retainer_cents,
      currency = v_revision.currency,
      proposal_snapshot_json = v_revision.proposal_snapshot_json,
      agreement_type = v_revision.agreement_type,
      terms_version = v_revision.terms_version,
      terms_source_markdown = v_revision.terms_source_markdown,
      terms_snapshot_markdown = v_revision.terms_snapshot_markdown,
      current_revision_number = v_effective_revision_number,
      published_revision_number = v_effective_revision_number,
      accepted_revision_number = v_effective_revision_number,
      stripe_checkout_session_id = NULLIF(trim(COALESCE(p_stripe_checkout_session_id, '')), ''),
      stripe_customer_id = NULLIF(trim(COALESCE(p_stripe_customer_id, '')), ''),
      stripe_subscription_id = NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), ''),
      payment_completed_at = now(),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_invitation_id;

  RETURN jsonb_build_object(
    'status', 'completed',
    'account_id', v_account_id,
    'accepted_revision_number', v_effective_revision_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_platform_invitation_draft(TEXT, TEXT, INTEGER, TEXT, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_invitation_draft(UUID, TEXT, TEXT, INTEGER, TEXT, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_platform_invitation(TEXT, TEXT, INTEGER, TEXT, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_invitation_revisions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_platform_invitation_revision(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_account_management_detail(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_platform_invitation(UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
