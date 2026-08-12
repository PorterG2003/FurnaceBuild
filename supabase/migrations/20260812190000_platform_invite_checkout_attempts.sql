-- Durable checkout-attempt state machine for platform invite payments.
-- Invitation lifecycle stays pending_payment → active; attempts track Stripe payment phase.

CREATE TABLE IF NOT EXISTS public.platform_invite_checkout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES public.platform_invitations(id) ON DELETE CASCADE,
  stripe_checkout_session_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_customer_id TEXT,
  payment_route TEXT CHECK (payment_route IS NULL OR payment_route IN ('card', 'ach')),
  phase TEXT NOT NULL DEFAULT 'open'
    CHECK (phase IN ('open', 'verification_required', 'processing', 'succeeded', 'failed', 'expired')),
  hosted_verification_url TEXT,
  failure_summary TEXT,
  last_stripe_event_id TEXT,
  last_stripe_event_type TEXT,
  last_reconciled_at TIMESTAMPTZ,
  provisioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_invite_checkout_attempts_session_unique UNIQUE (stripe_checkout_session_id)
);

CREATE INDEX IF NOT EXISTS platform_invite_checkout_attempts_invitation_idx
  ON public.platform_invite_checkout_attempts (invitation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_invite_checkout_attempts_payment_intent_idx
  ON public.platform_invite_checkout_attempts (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_invite_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  invitation_id UUID REFERENCES public.platform_invitations(id) ON DELETE SET NULL,
  checkout_attempt_id UUID REFERENCES public.platform_invite_checkout_attempts(id) ON DELETE SET NULL,
  handler_result TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS current_checkout_attempt_id UUID
    REFERENCES public.platform_invite_checkout_attempts(id) ON DELETE SET NULL;

ALTER TABLE public.platform_invite_checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_invite_stripe_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_platform_invite_checkout_attempts_updated_at
  ON public.platform_invite_checkout_attempts;
CREATE TRIGGER update_platform_invite_checkout_attempts_updated_at
  BEFORE UPDATE ON public.platform_invite_checkout_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill existing pending_payment / active invites that already have a checkout session.
INSERT INTO public.platform_invite_checkout_attempts (
  invitation_id,
  stripe_checkout_session_id,
  stripe_payment_intent_id,
  stripe_customer_id,
  payment_route,
  phase,
  created_at,
  updated_at
)
SELECT
  pi.id,
  pi.stripe_checkout_session_id,
  pi.upfront_stripe_payment_intent_id,
  pi.stripe_customer_id,
  pi.selected_payment_route,
  CASE
    WHEN pi.status = 'active' OR pi.created_account_id IS NOT NULL THEN 'succeeded'
    WHEN pi.selected_payment_route = 'ach' THEN 'verification_required'
    ELSE 'open'
  END,
  COALESCE(pi.updated_at, pi.created_at, now()),
  now()
FROM public.platform_invitations pi
WHERE pi.stripe_checkout_session_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.platform_invite_checkout_attempts existing
    WHERE existing.stripe_checkout_session_id = pi.stripe_checkout_session_id
  );

UPDATE public.platform_invitations pi
SET current_checkout_attempt_id = attempt.id,
    updated_at = now()
FROM public.platform_invite_checkout_attempts attempt
WHERE attempt.invitation_id = pi.id
  AND attempt.stripe_checkout_session_id = pi.stripe_checkout_session_id
  AND pi.current_checkout_attempt_id IS NULL
  AND pi.stripe_checkout_session_id IS NOT NULL;

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
  v_session_id TEXT := NULLIF(trim(COALESCE(p_stripe_checkout_session_id, '')), '');
  v_current_attempt public.platform_invite_checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_inv
  FROM public.platform_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF v_inv.created_account_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_completed',
      'account_id', v_inv.created_account_id
    );
  END IF;

  IF v_inv.accepted_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Invitation has not been prepared for checkout';
  END IF;

  IF v_inv.terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'Terms must be accepted before completion';
  END IF;

  IF v_session_id IS NOT NULL AND v_inv.current_checkout_attempt_id IS NOT NULL THEN
    SELECT * INTO v_current_attempt
    FROM public.platform_invite_checkout_attempts
    WHERE id = v_inv.current_checkout_attempt_id
    FOR UPDATE;

    IF FOUND
      AND v_current_attempt.stripe_checkout_session_id IS DISTINCT FROM v_session_id THEN
      RAISE EXCEPTION 'Checkout session is not the current invitation attempt';
    END IF;
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
    COALESCE(v_inv.prepared_account_name, v_revision.proposed_account_name, split_part(v_revision.email, '@', 1) || '''s Account'),
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
    terms_snapshot_markdown,
    preferred_payment_route
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
    v_revision.terms_snapshot_markdown,
    CASE
      WHEN v_inv.selected_payment_route IN ('card', 'ach') THEN v_inv.selected_payment_route
      ELSE NULL
    END
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
      stripe_checkout_session_id = COALESCE(v_session_id, stripe_checkout_session_id),
      stripe_customer_id = NULLIF(trim(COALESCE(p_stripe_customer_id, '')), ''),
      stripe_subscription_id = NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), ''),
      payment_completed_at = now(),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_invitation_id;

  IF v_inv.current_checkout_attempt_id IS NOT NULL THEN
    UPDATE public.platform_invite_checkout_attempts
    SET phase = 'succeeded',
        provisioned_at = COALESCE(provisioned_at, now()),
        failure_summary = NULL,
        last_reconciled_at = now(),
        updated_at = now()
    WHERE id = v_inv.current_checkout_attempt_id;
  ELSIF v_session_id IS NOT NULL THEN
    UPDATE public.platform_invite_checkout_attempts
    SET phase = 'succeeded',
        provisioned_at = COALESCE(provisioned_at, now()),
        failure_summary = NULL,
        last_reconciled_at = now(),
        updated_at = now()
    WHERE invitation_id = p_invitation_id
      AND stripe_checkout_session_id = v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'completed',
    'account_id', v_account_id,
    'accepted_revision_number', v_effective_revision_number
  );
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
  v_attempt RECORD;
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

  SELECT
    attempt.phase,
    attempt.stripe_checkout_session_id,
    attempt.hosted_verification_url,
    attempt.failure_summary
  INTO v_attempt
  FROM public.platform_invite_checkout_attempts attempt
  WHERE attempt.id = v_inv.current_checkout_attempt_id;

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
    'first_recurring_invoice_target_cents', v_inv.first_recurring_invoice_target_cents,
    'created_account_id', v_inv.created_account_id,
    'checkout_phase', v_attempt.phase,
    'checkout_session_id', v_attempt.stripe_checkout_session_id,
    'checkout_failure_summary', v_attempt.failure_summary,
    'has_hosted_verification', v_attempt.hosted_verification_url IS NOT NULL
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
  v_attempt RECORD;
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

    SELECT
      attempt.phase,
      attempt.stripe_checkout_session_id,
      attempt.stripe_payment_intent_id,
      attempt.failure_summary,
      attempt.last_stripe_event_type,
      attempt.last_reconciled_at,
      attempt.provisioned_at
    INTO v_attempt
    FROM public.platform_invite_checkout_attempts attempt
    WHERE attempt.id = v_inv.current_checkout_attempt_id;

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
        'updated_at', v_inv.updated_at,
        'current_checkout_attempt_id', v_inv.current_checkout_attempt_id,
        'checkout_phase', v_attempt.phase,
        'checkout_session_id', v_attempt.stripe_checkout_session_id,
        'checkout_payment_intent_id', v_attempt.stripe_payment_intent_id,
        'checkout_failure_summary', v_attempt.failure_summary,
        'checkout_last_event_type', v_attempt.last_stripe_event_type,
        'checkout_last_reconciled_at', v_attempt.last_reconciled_at,
        'checkout_provisioned_at', v_attempt.provisioned_at
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

GRANT EXECUTE ON FUNCTION public.complete_platform_invitation(UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_invitation_info(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_account_management_detail(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
