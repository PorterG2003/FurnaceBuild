ALTER TABLE public.platform_account_amendments
  ADD COLUMN IF NOT EXISTS payment_started_at TIMESTAMPTZ;

UPDATE public.account_billing ab
SET
  preferred_payment_route = pi.selected_payment_route,
  updated_at = now()
FROM public.platform_invitations pi
WHERE pi.created_account_id = ab.account_id
  AND pi.status = 'active'
  AND ab.preferred_payment_route IS NULL
  AND pi.selected_payment_route IN ('card', 'ach');

CREATE OR REPLACE FUNCTION public.next_platform_billing_anchor(
  p_reference TIMESTAMPTZ DEFAULT now()
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT (
    date_trunc('month', ((p_reference AT TIME ZONE 'UTC') - interval '7 hour') + interval '1 month')
    + interval '7 hour'
  ) AT TIME ZONE 'UTC'
$$;

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
  SELECT * INTO v_amendment
  FROM public.platform_account_amendments
  WHERE id = p_amendment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_amendment.status NOT IN ('pending_acceptance', 'pending_payment') THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = v_amendment.id
    AND revision_number = COALESCE(
      v_amendment.accepted_revision_number,
      v_amendment.published_revision_number,
      v_amendment.current_revision_number
    );

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'status', v_amendment.status,
      'amendment_id', v_amendment.id,
      'account_name', v_revision.account_name
    );
  END IF;

  IF NOT public.is_account_owner(v_amendment.account_id, v_uid)
     AND NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_billing
  FROM public.account_billing
  WHERE account_id = v_amendment.account_id;

  RETURN jsonb_build_object(
    'status', v_amendment.status,
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
    'published_at', v_amendment.published_at,
    'payment_started_at', v_amendment.payment_started_at,
    'preferred_payment_route', v_billing.preferred_payment_route
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_platform_account_amendment(
  p_amendment_id UUID,
  p_terms_accepted_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_amendment public.platform_account_amendments%ROWTYPE;
  v_revision public.platform_account_amendment_revisions%ROWTYPE;
  v_billing public.account_billing%ROWTYPE;
  v_old_retainer INTEGER;
  v_new_retainer INTEGER;
  v_change_kind TEXT;
  v_payment_started_at TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_amendment
  FROM public.platform_account_amendments
  WHERE id = p_amendment_id
    AND status IN ('pending_acceptance', 'pending_payment')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending amendment not found';
  END IF;

  IF NOT public.is_account_owner(v_amendment.account_id, v_uid) THEN
    RAISE EXCEPTION 'Only the account owner can accept amendments';
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = v_amendment.id
    AND revision_number = COALESCE(v_amendment.published_revision_number, v_amendment.current_revision_number);

  SELECT * INTO v_billing
  FROM public.account_billing
  WHERE account_id = v_amendment.account_id
  FOR UPDATE;

  v_old_retainer := v_billing.monthly_retainer_cents;
  v_new_retainer := v_revision.monthly_retainer_cents;
  v_payment_started_at := COALESCE(v_amendment.payment_started_at, now());

  IF v_new_retainer > v_old_retainer THEN
    v_change_kind := 'upgrade';
  ELSIF v_new_retainer < v_old_retainer THEN
    v_change_kind := 'downgrade';
  ELSE
    v_change_kind := 'unchanged';
  END IF;

  IF v_change_kind = 'upgrade' THEN
    IF v_amendment.status = 'pending_acceptance' THEN
      UPDATE public.platform_account_amendments
      SET
        status = 'pending_payment',
        payment_started_at = v_payment_started_at,
        updated_at = now()
      WHERE id = p_amendment_id;
    END IF;

    RETURN jsonb_build_object(
      'status', 'pending_payment',
      'billing_change_kind', v_change_kind,
      'requires_stripe_apply', true,
      'account_id', v_amendment.account_id,
      'old_monthly_retainer_cents', v_old_retainer,
      'new_monthly_retainer_cents', v_new_retainer,
      'amendment_id', v_amendment.id,
      'payment_started_at', v_payment_started_at,
      'preferred_payment_route', v_billing.preferred_payment_route
    );
  END IF;

  IF v_amendment.status = 'pending_payment' THEN
    RAISE EXCEPTION 'This amendment is awaiting payment completion';
  END IF;

  UPDATE public.platform_account_amendments
  SET
    status = 'accepted',
    accepted_revision_number = COALESCE(published_revision_number, current_revision_number),
    accepted_at = now(),
    accepted_by_user_id = v_uid,
    terms_accepted_ip = COALESCE(p_terms_accepted_ip, terms_accepted_ip),
    updated_at = now()
  WHERE id = p_amendment_id;

  IF v_change_kind = 'unchanged' THEN
    PERFORM public.apply_account_contract_from_revision(v_amendment.account_id, v_amendment.id, v_revision);

    INSERT INTO public.account_billing_changes (
      account_id,
      amendment_id,
      change_kind,
      old_monthly_retainer_cents,
      new_monthly_retainer_cents,
      created_by_user_id
    )
    VALUES (
      v_amendment.account_id,
      v_amendment.id,
      'amendment_accept',
      v_old_retainer,
      v_new_retainer,
      v_uid
    );

    RETURN jsonb_build_object(
      'status', 'accepted',
      'billing_change_kind', v_change_kind,
      'requires_stripe_apply', false,
      'account_id', v_amendment.account_id,
      'preferred_payment_route', v_billing.preferred_payment_route
    );
  END IF;

  UPDATE public.account_billing
  SET
    agreement_type = v_revision.agreement_type,
    proposal_snapshot_json = v_revision.proposal_snapshot_json,
    terms_version = v_revision.terms_version,
    terms_snapshot_markdown = v_revision.terms_snapshot_markdown,
    accepted_amendment_id = v_amendment.id,
    scheduled_monthly_retainer_cents = v_new_retainer,
    scheduled_retainer_effective_at = public.next_platform_billing_anchor(now()),
    updated_at = now()
  WHERE account_id = v_amendment.account_id;

  INSERT INTO public.account_billing_changes (
    account_id,
    amendment_id,
    change_kind,
    old_monthly_retainer_cents,
    new_monthly_retainer_cents,
    created_by_user_id,
    notes
  )
  VALUES (
    v_amendment.account_id,
    v_amendment.id,
    'downgrade',
    v_old_retainer,
    v_new_retainer,
    v_uid,
    'Scheduled for next billing cycle'
  );

  RETURN jsonb_build_object(
    'status', 'accepted',
    'billing_change_kind', v_change_kind,
    'requires_stripe_apply', true,
    'account_id', v_amendment.account_id,
    'scheduled_monthly_retainer_cents', v_new_retainer,
    'preferred_payment_route', v_billing.preferred_payment_route
  );
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
