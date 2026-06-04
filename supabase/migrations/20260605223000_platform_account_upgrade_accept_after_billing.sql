-- Keep upgrade amendments pending until the billing apply step succeeds.
-- This avoids losing the amendment accept flow when Stripe/apply fails and the
-- account remains on the old retainer in payment_required.

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_amendment
  FROM public.platform_account_amendments
  WHERE id = p_amendment_id AND status = 'pending_acceptance'
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

  SELECT * INTO v_billing FROM public.account_billing WHERE account_id = v_amendment.account_id FOR UPDATE;
  v_old_retainer := v_billing.monthly_retainer_cents;
  v_new_retainer := v_revision.monthly_retainer_cents;

  IF v_new_retainer > v_old_retainer THEN
    v_change_kind := 'upgrade';
  ELSIF v_new_retainer < v_old_retainer THEN
    v_change_kind := 'downgrade';
  ELSE
    v_change_kind := 'unchanged';
  END IF;

  IF v_change_kind = 'upgrade' THEN
    UPDATE public.platform_account_amendments
    SET
      terms_accepted_ip = COALESCE(p_terms_accepted_ip, terms_accepted_ip),
      updated_at = now()
    WHERE id = p_amendment_id;

    RETURN jsonb_build_object(
      'status', 'pending_payment',
      'billing_change_kind', v_change_kind,
      'requires_stripe_apply', true,
      'account_id', v_amendment.account_id,
      'old_monthly_retainer_cents', v_old_retainer,
      'new_monthly_retainer_cents', v_new_retainer,
      'amendment_id', v_amendment.id
    );
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
      account_id, amendment_id, change_kind,
      old_monthly_retainer_cents, new_monthly_retainer_cents,
      created_by_user_id
    )
    VALUES (
      v_amendment.account_id, v_amendment.id, 'amendment_accept',
      v_old_retainer, v_new_retainer, v_uid
    );

    RETURN jsonb_build_object(
      'status', 'accepted',
      'billing_change_kind', v_change_kind,
      'requires_stripe_apply', false,
      'account_id', v_amendment.account_id
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
    scheduled_retainer_effective_at = date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '1 month'),
    updated_at = now()
  WHERE account_id = v_amendment.account_id;

  INSERT INTO public.account_billing_changes (
    account_id, amendment_id, change_kind,
    old_monthly_retainer_cents, new_monthly_retainer_cents,
    created_by_user_id, notes
  )
  VALUES (
    v_amendment.account_id, v_amendment.id, 'downgrade',
    v_old_retainer, v_new_retainer, v_uid,
    'Scheduled for next billing cycle'
  );

  RETURN jsonb_build_object(
    'status', 'accepted',
    'billing_change_kind', v_change_kind,
    'requires_stripe_apply', true,
    'account_id', v_amendment.account_id,
    'scheduled_monthly_retainer_cents', v_new_retainer
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_account_amendment_upgrade(
  p_amendment_id UUID,
  p_new_monthly_retainer_cents INTEGER,
  p_pending_first_delta_coupon_cents INTEGER DEFAULT NULL,
  p_upgrade_delta_invoice_id TEXT DEFAULT NULL
)
RETURNS public.account_billing
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amendment public.platform_account_amendments%ROWTYPE;
  v_revision public.platform_account_amendment_revisions%ROWTYPE;
  v_billing public.account_billing%ROWTYPE;
BEGIN
  SELECT * INTO v_amendment
  FROM public.platform_account_amendments
  WHERE id = p_amendment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found';
  END IF;

  IF v_amendment.status NOT IN ('pending_acceptance', 'accepted') THEN
    RAISE EXCEPTION 'Amendment is not ready for upgrade completion';
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = p_amendment_id
    AND revision_number = COALESCE(
      v_amendment.accepted_revision_number,
      v_amendment.published_revision_number,
      v_amendment.current_revision_number
    );

  UPDATE public.account_billing
  SET
    monthly_retainer_cents = p_new_monthly_retainer_cents,
    agreement_type = v_revision.agreement_type,
    proposal_snapshot_json = v_revision.proposal_snapshot_json,
    terms_version = v_revision.terms_version,
    terms_snapshot_markdown = v_revision.terms_snapshot_markdown,
    accepted_amendment_id = p_amendment_id,
    pending_first_delta_coupon_cents = p_pending_first_delta_coupon_cents,
    upgrade_delta_invoice_id = NULLIF(trim(COALESCE(p_upgrade_delta_invoice_id, '')), ''),
    upgrade_delta_charged_at = now(),
    scheduled_monthly_retainer_cents = NULL,
    scheduled_retainer_effective_at = NULL,
    updated_at = now()
  WHERE account_id = v_amendment.account_id
  RETURNING * INTO v_billing;

  UPDATE public.platform_account_amendments
  SET
    status = 'accepted',
    accepted_revision_number = COALESCE(published_revision_number, current_revision_number),
    accepted_at = COALESCE(accepted_at, now()),
    updated_at = now()
  WHERE id = p_amendment_id;

  RETURN v_billing;
END;
$$;
