DO $$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        pg_get_constraintdef(con.oid) = 'CHECK ((monthly_retainer_cents > 0))'
        OR pg_get_constraintdef(con.oid) = 'CHECK (((scheduled_monthly_retainer_cents IS NULL) OR (scheduled_monthly_retainer_cents > 0)))'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      v_constraint.schema_name,
      v_constraint.table_name,
      v_constraint.constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_monthly_retainer_cents_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_monthly_retainer_cents_check
  CHECK (monthly_retainer_cents >= 0);

ALTER TABLE public.platform_invitation_revisions
  DROP CONSTRAINT IF EXISTS platform_invitation_revisions_monthly_retainer_cents_check;

ALTER TABLE public.platform_invitation_revisions
  ADD CONSTRAINT platform_invitation_revisions_monthly_retainer_cents_check
  CHECK (monthly_retainer_cents >= 0);

ALTER TABLE public.account_billing
  DROP CONSTRAINT IF EXISTS account_billing_monthly_retainer_cents_check;

ALTER TABLE public.account_billing
  ADD CONSTRAINT account_billing_monthly_retainer_cents_check
  CHECK (monthly_retainer_cents >= 0);

ALTER TABLE public.account_billing
  DROP CONSTRAINT IF EXISTS account_billing_scheduled_monthly_retainer_cents_check;

ALTER TABLE public.account_billing
  ADD CONSTRAINT account_billing_scheduled_monthly_retainer_cents_check
  CHECK (scheduled_monthly_retainer_cents IS NULL OR scheduled_monthly_retainer_cents >= 0);

ALTER TABLE public.platform_account_amendment_revisions
  DROP CONSTRAINT IF EXISTS platform_account_amendment_revisions_monthly_retainer_cents_check;

ALTER TABLE public.platform_account_amendment_revisions
  ADD CONSTRAINT platform_account_amendment_revisions_monthly_retainer_cents_check
  CHECK (monthly_retainer_cents >= 0);

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

  IF p_monthly_retainer_cents < 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be zero or greater';
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

  IF p_monthly_retainer_cents < 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be zero or greater';
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

CREATE OR REPLACE FUNCTION public.update_platform_account_amendment_draft(
  p_amendment_id UUID,
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
  v_amendment public.platform_account_amendments%ROWTYPE;
  v_billing public.account_billing%ROWTYPE;
  v_terms public.platform_terms_versions%ROWTYPE;
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

  SELECT * INTO v_amendment FROM public.platform_account_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found';
  END IF;

  IF v_amendment.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft amendments can be edited';
  END IF;

  SELECT * INTO v_billing FROM public.account_billing WHERE account_id = v_amendment.account_id;

  IF p_monthly_retainer_cents < 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be zero or greater';
  END IF;

  v_agreement_type := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed_services_agreement'
    WHEN p_agreement_type = 'platform_agreement' THEN 'platform_agreement'
    ELSE COALESCE(v_billing.agreement_type, 'platform_agreement')
  END;

  IF COALESCE(p_terms_version, '') = '' THEN
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE agreement_type = v_agreement_type AND is_default = true
    ORDER BY effective_at DESC
    LIMIT 1;
  ELSE
    SELECT * INTO v_terms FROM public.platform_terms_versions WHERE version = p_terms_version;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terms version not found';
  END IF;

  v_agreement_type := v_terms.agreement_type;
  v_terms_source_markdown := COALESCE(NULLIF(p_terms_source_markdown, ''), v_terms.body_markdown);
  v_terms_snapshot_markdown := public.render_platform_terms_markdown(
    v_terms_source_markdown,
    p_account_name,
    p_monthly_retainer_cents,
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    now()
  );

  v_next_revision := v_amendment.current_revision_number + 1;

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
    v_next_revision,
    COALESCE(NULLIF(trim(COALESCE(p_account_name, '')), ''), 'Account'),
    p_monthly_retainer_cents,
    lower(trim(COALESCE(p_currency, 'usd'))),
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    v_agreement_type,
    v_terms.version,
    v_terms_source_markdown,
    v_terms_snapshot_markdown,
    v_uid
  );

  UPDATE public.platform_account_amendments
  SET current_revision_number = v_next_revision, updated_at = now()
  WHERE id = p_amendment_id
  RETURNING * INTO v_amendment;

  RETURN v_amendment;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_platform_invitation(
  p_invitation_id UUID,
  p_full_name TEXT,
  p_account_name TEXT,
  p_terms_accepted_ip TEXT DEFAULT NULL,
  p_internal_admin_emails TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_inv public.platform_invitations%ROWTYPE;
  v_revision public.platform_invitation_revisions%ROWTYPE;
  v_effective_revision_number INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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

  SELECT lower(email) INTO v_email
  FROM auth.users
  WHERE id = v_uid;

  v_effective_revision_number := COALESCE(
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

  IF v_revision.monthly_retainer_cents <> 0 THEN
    RAISE EXCEPTION 'Paid invitations must use checkout';
  END IF;

  UPDATE public.platform_invitations
  SET
    accepted_by_user_id = v_uid,
    prepared_full_name = NULLIF(trim(COALESCE(p_full_name, '')), ''),
    prepared_account_name = NULLIF(trim(COALESCE(p_account_name, '')), ''),
    terms_accepted_at = now(),
    terms_accepted_ip = COALESCE(p_terms_accepted_ip, terms_accepted_ip),
    checkout_revision_number = v_effective_revision_number,
    status = 'pending_payment',
    updated_at = now()
  WHERE id = p_invitation_id
    AND lower(email) = COALESCE(v_email, '')
    AND status IN ('sent', 'pending_payment')
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or email mismatch';
  END IF;

  IF v_inv.prepared_full_name IS NULL OR v_inv.prepared_account_name IS NULL THEN
    RAISE EXCEPTION 'Full name and account name are required';
  END IF;

  UPDATE public.users
  SET
    name = v_inv.prepared_full_name,
    updated_at = now()
  WHERE id = v_uid;

  RETURN public.complete_platform_invitation(
    p_invitation_id,
    '',
    '',
    '',
    p_internal_admin_emails
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_platform_invitation(UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
