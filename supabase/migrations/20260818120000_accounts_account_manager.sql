-- Account manager for Need Help strategy/check-in routing.
-- NULL means Porter (the default). Platform admins set this from Account Management.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_manager TEXT
  CHECK (account_manager IS NULL OR account_manager IN ('porter', 'kyle'));

COMMENT ON COLUMN public.accounts.account_manager IS
  'Need Help strategy/check-in owner (porter | kyle). NULL defaults to Porter. Technical support always routes to Porter.';

CREATE OR REPLACE FUNCTION public.admin_set_account_manager(
  p_account_id UUID,
  p_manager TEXT
)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.accounts;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_manager IS NOT NULL AND p_manager NOT IN ('porter', 'kyle') THEN
    RAISE EXCEPTION 'Invalid account manager: %', p_manager;
  END IF;

  UPDATE public.accounts
     SET account_manager = p_manager
   WHERE id = p_account_id
  RETURNING * INTO v_account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  RETURN v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_account_manager(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_non_admin_account_manager_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.account_manager IS DISTINCT FROM OLD.account_manager
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized to change account manager';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_guard_account_manager ON public.accounts;
CREATE TRIGGER accounts_guard_account_manager
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_admin_account_manager_update();

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
        'onboarding_segment', v_account.onboarding_segment,
        'account_manager', v_account.account_manager,
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

GRANT EXECUTE ON FUNCTION public.get_platform_account_management_detail(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
