-- ============================================
-- Platform invite upfront invoice + recurring subscription metadata
-- ============================================

ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS upfront_stripe_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS upfront_stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS recurring_anchor_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_recurring_invoice_target_cents INTEGER,
  ADD COLUMN IF NOT EXISTS first_recurring_coupon_id TEXT;

ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_first_recurring_invoice_target_cents_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_first_recurring_invoice_target_cents_check
  CHECK (
    first_recurring_invoice_target_cents IS NULL
    OR first_recurring_invoice_target_cents >= 0
  );

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
      SELECT a.*
      INTO v_account
      FROM public.accounts a
      WHERE a.id = v_inv.created_account_id;

      SELECT to_jsonb(ab.*)
      INTO v_billing
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
        'first_month_discount_cents', v_inv.first_month_discount_cents,
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
      SELECT
        u.id AS user_id,
        u.email,
        u.name
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

    SELECT to_jsonb(ab.*)
    INTO v_billing
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
  IF v_status IN ('draft', 'approved', 'sent', 'pending')
     AND v_inv.expires_at IS NOT NULL
     AND v_inv.expires_at < now() THEN
    UPDATE public.platform_invitations
    SET status = 'expired',
        updated_at = now()
    WHERE id = p_invitation_id
      AND status IN ('draft', 'approved', 'sent', 'pending');
    v_status := 'expired';
  END IF;

  IF v_status = 'revoked' THEN
    RETURN jsonb_build_object('status', 'revoked');
  END IF;

  IF v_status = 'expired' THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF v_status IN ('draft', 'approved') THEN
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

NOTIFY pgrst, 'reload schema';
