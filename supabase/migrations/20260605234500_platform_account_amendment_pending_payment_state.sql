ALTER TABLE public.platform_account_amendments
  DROP CONSTRAINT IF EXISTS platform_account_amendments_status_check;

ALTER TABLE public.platform_account_amendments
  ADD CONSTRAINT platform_account_amendments_status_check
  CHECK (status IN ('draft', 'pending_acceptance', 'pending_payment', 'accepted', 'superseded', 'canceled'));

DROP INDEX IF EXISTS idx_platform_account_amendments_pending_account;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_account_amendments_pending_account
  ON public.platform_account_amendments (account_id)
  WHERE status IN ('pending_acceptance', 'pending_payment');

CREATE OR REPLACE FUNCTION public.create_platform_account_amendment_draft(
  p_account_id UUID,
  p_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
  p_proposal_snapshot_json JSONB DEFAULT '{}'::jsonb,
  p_terms_version TEXT DEFAULT NULL,
  p_agreement_type TEXT DEFAULT NULL,
  p_terms_source_markdown TEXT DEFAULT NULL
)
RETURNS public.platform_account_amendments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_account public.accounts%ROWTYPE;
  v_billing public.account_billing%ROWTYPE;
  v_terms public.platform_terms_versions%ROWTYPE;
  v_amendment public.platform_account_amendments%ROWTYPE;
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

  SELECT * INTO v_account FROM public.accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  SELECT * INTO v_billing FROM public.account_billing WHERE account_id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account billing not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.platform_account_amendments
    WHERE account_id = p_account_id
      AND status IN ('pending_acceptance', 'pending_payment')
  ) THEN
    RAISE EXCEPTION 'Account already has a pending amendment';
  END IF;

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
  END IF;

  v_agreement_type := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed_services_agreement'
    WHEN p_agreement_type = 'platform_agreement' THEN 'platform_agreement'
    ELSE COALESCE(v_billing.agreement_type, 'platform_agreement')
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
    NULLIF(trim(COALESCE(p_account_name, '')), ''),
    p_monthly_retainer_cents,
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    now()
  );

  INSERT INTO public.platform_account_amendments (
    account_id,
    status,
    current_revision_number,
    created_by_user_id
  )
  VALUES (
    p_account_id,
    'draft',
    1,
    v_uid
  )
  RETURNING * INTO v_amendment;

  INSERT INTO public.platform_account_amendment_revisions (
    amendment_id,
    revision_number,
    account_name,
    monthly_retainer_cents,
    currency,
    proposal_snapshot_json,
    agreement_type,
    terms_version,
    terms_source_markdown,
    terms_snapshot_markdown,
    created_by_user_id
  )
  VALUES (
    v_amendment.id,
    1,
    COALESCE(NULLIF(trim(COALESCE(p_account_name, '')), ''), v_account.name),
    p_monthly_retainer_cents,
    lower(trim(COALESCE(p_currency, 'usd'))),
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    v_agreement_type,
    v_terms.version,
    v_terms_source_markdown,
    v_terms_snapshot_markdown,
    v_uid
  );

  RETURN v_amendment;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_platform_account_amendment(p_amendment_id UUID)
RETURNS public.platform_account_amendments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amendment public.platform_account_amendments%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.platform_account_amendments
  SET status = 'canceled', updated_at = now()
  WHERE id = p_amendment_id
    AND status IN ('draft', 'pending_acceptance', 'pending_payment')
  RETURNING * INTO v_amendment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found or cannot be canceled';
  END IF;

  RETURN v_amendment;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_platform_account_amendment(
  p_account_id UUID
)
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_account_member(p_account_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_amendment
  FROM public.platform_account_amendments
  WHERE account_id = p_account_id
    AND status IN ('pending_acceptance', 'pending_payment')
  ORDER BY
    CASE WHEN status = 'pending_payment' THEN 0 ELSE 1 END,
    updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = v_amendment.id
    AND revision_number = COALESCE(
      v_amendment.accepted_revision_number,
      v_amendment.published_revision_number,
      v_amendment.current_revision_number
    );

  RETURN jsonb_build_object(
    'amendment_id', v_amendment.id,
    'account_id', v_amendment.account_id,
    'status', v_amendment.status,
    'published_revision_number', v_amendment.published_revision_number,
    'published_at', v_amendment.published_at,
    'account_name', v_revision.account_name,
    'monthly_retainer_cents', v_revision.monthly_retainer_cents,
    'currency', v_revision.currency,
    'proposal_snapshot_json', v_revision.proposal_snapshot_json,
    'agreement_type', v_revision.agreement_type,
    'terms_version', v_revision.terms_version,
    'terms_snapshot_markdown', v_revision.terms_snapshot_markdown
  );
END;
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
    'published_at', v_amendment.published_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_account_amendment_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_platform_account_amendment_info(UUID) TO authenticated;

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
      'amendment_id', v_amendment.id
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
    'scheduled_monthly_retainer_cents', v_new_retainer
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_account_amendment_upgrade(
  p_amendment_id UUID,
  p_new_monthly_retainer_cents INTEGER,
  p_pending_first_delta_coupon_cents INTEGER DEFAULT NULL,
  p_upgrade_delta_invoice_id TEXT DEFAULT NULL,
  p_accepted_by_user_id UUID DEFAULT NULL,
  p_terms_accepted_ip TEXT DEFAULT NULL
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
  v_old_retainer INTEGER;
BEGIN
  SELECT * INTO v_amendment
  FROM public.platform_account_amendments
  WHERE id = p_amendment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found';
  END IF;

  IF v_amendment.status NOT IN ('pending_acceptance', 'pending_payment', 'accepted') THEN
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

  SELECT * INTO v_billing
  FROM public.account_billing
  WHERE account_id = v_amendment.account_id
  FOR UPDATE;

  v_old_retainer := v_billing.monthly_retainer_cents;

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
    accepted_by_user_id = COALESCE(p_accepted_by_user_id, accepted_by_user_id),
    terms_accepted_ip = COALESCE(p_terms_accepted_ip, terms_accepted_ip),
    updated_at = now()
  WHERE id = p_amendment_id;

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
    p_amendment_id,
    'upgrade',
    v_old_retainer,
    p_new_monthly_retainer_cents,
    p_accepted_by_user_id,
    'Applied after successful payment'
  );

  RETURN v_billing;
END;
$$;

DROP FUNCTION IF EXISTS public.list_platform_account_management_records();

CREATE FUNCTION public.list_platform_account_management_records()
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
  updated_at TIMESTAMPTZ,
  has_pending_terms BOOLEAN,
  has_amendment_draft BOOLEAN,
  has_scheduled_downgrade BOOLEAN,
  agreement_type TEXT,
  plan_tier TEXT
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
    pi.updated_at,
    false AS has_pending_terms,
    false AS has_amendment_draft,
    (ab.scheduled_monthly_retainer_cents IS NOT NULL) AS has_scheduled_downgrade,
    COALESCE(ab.agreement_type, pi.agreement_type) AS agreement_type,
    COALESCE(ab.proposal_snapshot_json->>'plan_tier', pi.proposal_snapshot_json->>'plan_tier') AS plan_tier
  FROM public.platform_invitations pi
  LEFT JOIN public.accounts a ON a.id = pi.created_account_id
  LEFT JOIN public.account_billing ab ON ab.account_id = pi.created_account_id
  WHERE NOT (pi.created_account_id IS NOT NULL AND pi.status = 'active')

  UNION ALL

  SELECT
    'account'::TEXT AS record_kind,
    a.id AS record_id,
    NULL::UUID AS invitation_id,
    a.id AS account_id,
    'active'::TEXT AS lifecycle_status,
    CASE
      WHEN pending_amendment.id IS NOT NULL AND pending_amendment.status = 'pending_payment'
        THEN format('Pending payment v%s', pending_amendment.published_revision_number)
      WHEN pending_amendment.id IS NOT NULL
        THEN format('Pending acceptance v%s', pending_amendment.published_revision_number)
      WHEN draft_amendment.id IS NOT NULL
        THEN format('Draft amendment v%s', draft_amendment.current_revision_number)
      ELSE 'Active account'
    END AS revision_state,
    a.name AS display_name,
    owner.email AS primary_email,
    ab.monthly_retainer_cents,
    ab.billing_status,
    NULL::INTEGER AS current_revision_number,
    pending_amendment.published_revision_number,
    pending_amendment.accepted_revision_number,
    NULL::TIMESTAMPTZ AS sent_at,
    COALESCE(pending_amendment.published_at, draft_amendment.updated_at, ab.updated_at, a.updated_at) AS last_activity_at,
    GREATEST(a.updated_at, ab.updated_at, COALESCE(pending_amendment.updated_at, draft_amendment.updated_at, a.updated_at)) AS updated_at,
    (pending_amendment.id IS NOT NULL) AS has_pending_terms,
    (draft_amendment.id IS NOT NULL) AS has_amendment_draft,
    (ab.scheduled_monthly_retainer_cents IS NOT NULL) AS has_scheduled_downgrade,
    ab.agreement_type,
    ab.proposal_snapshot_json->>'plan_tier' AS plan_tier
  FROM public.accounts a
  JOIN public.account_billing ab ON ab.account_id = a.id
  LEFT JOIN LATERAL (
    SELECT u.email
    FROM public.account_users au
    JOIN public.users u ON u.id = au.user_id
    WHERE au.account_id = a.id AND au.is_owner = true
    ORDER BY au.created_at ASC
    LIMIT 1
  ) owner ON true
  LEFT JOIN LATERAL (
    SELECT pa.*
    FROM public.platform_account_amendments pa
    WHERE pa.account_id = a.id
      AND pa.status IN ('pending_acceptance', 'pending_payment')
    ORDER BY
      CASE WHEN pa.status = 'pending_payment' THEN 0 ELSE 1 END,
      pa.updated_at DESC
    LIMIT 1
  ) pending_amendment ON true
  LEFT JOIN LATERAL (
    SELECT pa.*
    FROM public.platform_account_amendments pa
    WHERE pa.account_id = a.id AND pa.status = 'draft'
    ORDER BY pa.updated_at DESC
    LIMIT 1
  ) draft_amendment ON true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_account_management_records() TO authenticated;
