-- ============================================
-- Platform invite proration mode
--
-- 'second_month' (default, existing behavior): charge a full month today and
-- prorate the first recurring invoice via an overlap credit.
-- 'first_month': prorate today by the remaining days of the signup month and
-- charge a full retainer on the first recurring invoice.
-- ============================================

ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS proration_mode TEXT NOT NULL DEFAULT 'second_month';

ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_proration_mode_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_proration_mode_check
  CHECK (proration_mode IN ('second_month', 'first_month'));

ALTER TABLE public.platform_invitation_revisions
  ADD COLUMN IF NOT EXISTS proration_mode TEXT NOT NULL DEFAULT 'second_month';

ALTER TABLE public.platform_invitation_revisions
  DROP CONSTRAINT IF EXISTS platform_invitation_revisions_proration_mode_check;

ALTER TABLE public.platform_invitation_revisions
  ADD CONSTRAINT platform_invitation_revisions_proration_mode_check
  CHECK (proration_mode IN ('second_month', 'first_month'));

-- Argument counts change, so the previous signatures must be dropped rather than replaced.
DROP FUNCTION IF EXISTS public.create_platform_invitation_draft(
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
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
  p_terms_source_markdown TEXT DEFAULT NULL,
  p_proration_mode TEXT DEFAULT 'second_month'
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
  v_proration_mode TEXT := CASE
    WHEN p_proration_mode = 'first_month' THEN 'first_month'
    ELSE 'second_month'
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

  IF p_monthly_retainer_cents < 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be zero or greater';
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
    current_revision_number,
    proration_mode
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
    1,
    v_proration_mode
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
    created_at,
    proration_mode
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
    now(),
    v_inv.proration_mode
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
  p_terms_source_markdown TEXT DEFAULT NULL,
  p_proration_mode TEXT DEFAULT NULL
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
  v_proration_mode TEXT;
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

  IF p_monthly_retainer_cents < 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be zero or greater';
  END IF;

  v_agreement_type := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed_services_agreement'
    WHEN p_agreement_type = 'platform_agreement' THEN 'platform_agreement'
    ELSE COALESCE(v_inv.agreement_type, 'platform_agreement')
  END;

  v_proration_mode := CASE
    WHEN p_proration_mode = 'first_month' THEN 'first_month'
    WHEN p_proration_mode = 'second_month' THEN 'second_month'
    ELSE COALESCE(v_inv.proration_mode, 'second_month')
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
    created_at,
    proration_mode
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
    now(),
    v_proration_mode
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
    proration_mode = v_proration_mode,
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
  p_terms_source_markdown TEXT DEFAULT NULL,
  p_proration_mode TEXT DEFAULT 'second_month'
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
    p_terms_source_markdown,
    p_proration_mode
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
    created_at,
    proration_mode
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
    now(),
    COALESCE(v_source.proration_mode, 'second_month')
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
    proration_mode = COALESCE(v_source.proration_mode, 'second_month'),
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
  proration_mode TEXT,
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
    COALESCE(pir.proration_mode, 'second_month') AS proration_mode,
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
    pir.terms_snapshot_markdown,
    pir.proration_mode
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
    'proration_mode', COALESCE(v_revision.proration_mode, 'second_month'),
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

NOTIFY pgrst, 'reload schema';
