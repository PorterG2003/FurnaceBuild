-- ============================================
-- Post-activation account amendments, contract snapshot, billing changes
-- ============================================

-- Contract snapshot on account_billing
ALTER TABLE public.account_billing
  ADD COLUMN IF NOT EXISTS agreement_type TEXT
    CHECK (agreement_type IS NULL OR agreement_type IN ('platform_agreement', 'managed_services_agreement')),
  ADD COLUMN IF NOT EXISTS proposal_snapshot_json JSONB,
  ADD COLUMN IF NOT EXISTS terms_version TEXT,
  ADD COLUMN IF NOT EXISTS terms_snapshot_markdown TEXT,
  ADD COLUMN IF NOT EXISTS accepted_amendment_id UUID,
  ADD COLUMN IF NOT EXISTS preferred_payment_route TEXT
    CHECK (preferred_payment_route IS NULL OR preferred_payment_route IN ('card', 'ach')),
  ADD COLUMN IF NOT EXISTS pending_first_delta_coupon_cents INTEGER
    CHECK (pending_first_delta_coupon_cents IS NULL OR pending_first_delta_coupon_cents >= 0),
  ADD COLUMN IF NOT EXISTS upgrade_delta_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS upgrade_delta_charged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_monthly_retainer_cents INTEGER
    CHECK (scheduled_monthly_retainer_cents IS NULL OR scheduled_monthly_retainer_cents > 0),
  ADD COLUMN IF NOT EXISTS scheduled_retainer_effective_at TIMESTAMPTZ;

-- Backfill contract snapshot from originating active invitation
UPDATE public.account_billing ab
SET
  agreement_type = COALESCE(ab.agreement_type, pi.agreement_type),
  proposal_snapshot_json = COALESCE(ab.proposal_snapshot_json, pi.proposal_snapshot_json),
  terms_version = COALESCE(ab.terms_version, pi.terms_version),
  terms_snapshot_markdown = COALESCE(ab.terms_snapshot_markdown, pi.terms_snapshot_markdown)
FROM public.platform_invitations pi
WHERE pi.created_account_id = ab.account_id
  AND pi.status = 'active';

CREATE TABLE IF NOT EXISTS public.platform_account_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_acceptance', 'accepted', 'superseded', 'canceled')),
  current_revision_number INTEGER NOT NULL DEFAULT 1 CHECK (current_revision_number > 0),
  published_revision_number INTEGER,
  accepted_revision_number INTEGER,
  published_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  terms_accepted_ip TEXT,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_account_amendments_pending_account
  ON public.platform_account_amendments (account_id)
  WHERE status = 'pending_acceptance';

CREATE INDEX IF NOT EXISTS idx_platform_account_amendments_account
  ON public.platform_account_amendments (account_id, updated_at DESC);

CREATE TRIGGER update_platform_account_amendments_updated_at
  BEFORE UPDATE ON public.platform_account_amendments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.platform_account_amendments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.platform_account_amendment_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amendment_id UUID NOT NULL REFERENCES public.platform_account_amendments(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  account_name TEXT NOT NULL,
  monthly_retainer_cents INTEGER NOT NULL CHECK (monthly_retainer_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  proposal_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  agreement_type TEXT NOT NULL
    CHECK (agreement_type IN ('platform_agreement', 'managed_services_agreement')),
  terms_version TEXT NOT NULL REFERENCES public.platform_terms_versions(version) ON DELETE RESTRICT,
  terms_source_markdown TEXT NOT NULL,
  terms_snapshot_markdown TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (amendment_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_platform_account_amendment_revisions_amendment
  ON public.platform_account_amendment_revisions (amendment_id, revision_number DESC);

ALTER TABLE public.platform_account_amendment_revisions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_billing
  ADD CONSTRAINT account_billing_accepted_amendment_id_fkey
  FOREIGN KEY (accepted_amendment_id) REFERENCES public.platform_account_amendments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.account_billing_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  amendment_id UUID REFERENCES public.platform_account_amendments(id) ON DELETE SET NULL,
  change_kind TEXT NOT NULL
    CHECK (change_kind IN ('upgrade', 'downgrade', 'unchanged', 'admin_edit', 'amendment_accept')),
  old_monthly_retainer_cents INTEGER NOT NULL,
  new_monthly_retainer_cents INTEGER NOT NULL,
  old_preferred_payment_route TEXT,
  new_preferred_payment_route TEXT,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  stripe_invoice_id TEXT,
  stripe_subscription_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_billing_changes_account
  ON public.account_billing_changes (account_id, created_at DESC);

ALTER TABLE public.account_billing_changes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_account_owner(
  p_account_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_users au
    WHERE au.account_id = p_account_id
      AND au.user_id = p_user_id
      AND au.is_owner = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(
  p_account_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_users au
    WHERE au.account_id = p_account_id
      AND au.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_account_contract_from_revision(
  p_account_id UUID,
  p_amendment_id UUID,
  p_revision public.platform_account_amendment_revisions
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.account_billing
  SET
    monthly_retainer_cents = p_revision.monthly_retainer_cents,
    agreement_type = p_revision.agreement_type,
    proposal_snapshot_json = p_revision.proposal_snapshot_json,
    terms_version = p_revision.terms_version,
    terms_snapshot_markdown = p_revision.terms_snapshot_markdown,
    accepted_amendment_id = p_amendment_id,
    updated_at = now()
  WHERE account_id = p_account_id;
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
    SELECT 1 FROM public.platform_account_amendments
    WHERE account_id = p_account_id AND status = 'pending_acceptance'
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
    NULLIF(trim(COALESCE(p_account_name, '')), ''),
    p_monthly_retainer_cents,
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    now()
  );

  INSERT INTO public.platform_account_amendments (
    account_id, status, current_revision_number, created_by_user_id
  )
  VALUES (p_account_id, 'draft', 1, v_uid)
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

CREATE OR REPLACE FUNCTION public.publish_platform_account_amendment(p_amendment_id UUID)
RETURNS public.platform_account_amendments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amendment public.platform_account_amendments%ROWTYPE;
  v_billing public.account_billing%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_amendment FROM public.platform_account_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found';
  END IF;

  IF v_amendment.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft amendments can be published';
  END IF;

  SELECT * INTO v_billing FROM public.account_billing WHERE account_id = v_amendment.account_id;
  IF v_billing.billing_status = 'payment_required' THEN
    RAISE EXCEPTION 'Resolve payment issues before publishing a new amendment';
  END IF;

  UPDATE public.platform_account_amendments
  SET
    status = 'pending_acceptance',
    published_revision_number = current_revision_number,
    published_at = now(),
    updated_at = now()
  WHERE id = p_amendment_id
  RETURNING * INTO v_amendment;

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
    AND status IN ('draft', 'pending_acceptance')
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
  WHERE account_id = p_account_id AND status = 'pending_acceptance'
  ORDER BY published_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = v_amendment.id
    AND revision_number = COALESCE(v_amendment.published_revision_number, v_amendment.current_revision_number);

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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_amendment FROM public.platform_account_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF NOT public.is_account_owner(v_amendment.account_id, v_uid)
     AND NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_amendment.status <> 'pending_acceptance' THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = v_amendment.id
    AND revision_number = COALESCE(v_amendment.published_revision_number, v_amendment.current_revision_number);

  SELECT * INTO v_billing FROM public.account_billing WHERE account_id = v_amendment.account_id;

  RETURN jsonb_build_object(
    'status', 'pending_acceptance',
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

  IF v_change_kind = 'downgrade' THEN
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
  END IF;

  -- upgrade: contract snapshot applied after successful Stripe charge (via service role helper)
  RETURN jsonb_build_object(
    'status', 'accepted',
    'billing_change_kind', v_change_kind,
    'requires_stripe_apply', true,
    'account_id', v_amendment.account_id,
    'old_monthly_retainer_cents', v_old_retainer,
    'new_monthly_retainer_cents', v_new_retainer,
    'amendment_id', v_amendment.id
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
  SELECT * INTO v_amendment FROM public.platform_account_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found';
  END IF;

  SELECT * INTO v_revision
  FROM public.platform_account_amendment_revisions
  WHERE amendment_id = p_amendment_id
    AND revision_number = COALESCE(v_amendment.accepted_revision_number, v_amendment.published_revision_number);

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

  RETURN v_billing;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_account_billing(
  p_account_id UUID,
  p_monthly_retainer_cents INTEGER,
  p_preferred_payment_route TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_billing public.account_billing%ROWTYPE;
  v_old_retainer INTEGER;
  v_change_kind TEXT;
  v_route TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
  END IF;

  v_route := CASE
    WHEN p_preferred_payment_route = 'ach' THEN 'ach'
    WHEN p_preferred_payment_route = 'card' THEN 'card'
    ELSE NULL
  END;

  SELECT * INTO v_billing FROM public.account_billing WHERE account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account billing not found';
  END IF;

  IF v_billing.billing_status = 'payment_required' AND p_monthly_retainer_cents > v_billing.monthly_retainer_cents THEN
    RAISE EXCEPTION 'Resolve payment issues before increasing retainer';
  END IF;

  v_old_retainer := v_billing.monthly_retainer_cents;

  IF p_monthly_retainer_cents > v_old_retainer THEN
    v_change_kind := 'upgrade';
  ELSIF p_monthly_retainer_cents < v_old_retainer THEN
    v_change_kind := 'downgrade';
  ELSE
    v_change_kind := 'unchanged';
  END IF;

  IF v_change_kind = 'downgrade' THEN
    UPDATE public.account_billing
    SET
      preferred_payment_route = COALESCE(v_route, preferred_payment_route),
      scheduled_monthly_retainer_cents = p_monthly_retainer_cents,
      scheduled_retainer_effective_at = date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '1 month'),
      updated_at = now()
    WHERE account_id = p_account_id
    RETURNING * INTO v_billing;
  ELSIF v_change_kind = 'unchanged' THEN
    UPDATE public.account_billing
    SET
      preferred_payment_route = COALESCE(v_route, preferred_payment_route),
      updated_at = now()
    WHERE account_id = p_account_id
    RETURNING * INTO v_billing;
  ELSE
    UPDATE public.account_billing
    SET preferred_payment_route = COALESCE(v_route, preferred_payment_route), updated_at = now()
    WHERE account_id = p_account_id
    RETURNING * INTO v_billing;
  END IF;

  INSERT INTO public.account_billing_changes (
    account_id, change_kind,
    old_monthly_retainer_cents, new_monthly_retainer_cents,
    old_preferred_payment_route, new_preferred_payment_route,
    created_by_user_id
  )
  VALUES (
    p_account_id, COALESCE(v_change_kind, 'admin_edit'),
    v_old_retainer, p_monthly_retainer_cents,
    v_billing.preferred_payment_route, COALESCE(v_route, v_billing.preferred_payment_route),
    v_uid
  );

  RETURN jsonb_build_object(
    'billing_change_kind', v_change_kind,
    'requires_stripe_apply', v_change_kind IN ('upgrade', 'downgrade'),
    'account_id', p_account_id,
    'old_monthly_retainer_cents', v_old_retainer,
    'new_monthly_retainer_cents', p_monthly_retainer_cents,
    'scheduled_monthly_retainer_cents', v_billing.scheduled_monthly_retainer_cents,
    'scheduled_retainer_effective_at', v_billing.scheduled_retainer_effective_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_scheduled_account_billing_retainer(p_account_id UUID)
RETURNS public.account_billing
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing public.account_billing%ROWTYPE;
BEGIN
  UPDATE public.account_billing
  SET
    monthly_retainer_cents = scheduled_monthly_retainer_cents,
    scheduled_monthly_retainer_cents = NULL,
    scheduled_retainer_effective_at = NULL,
    updated_at = now()
  WHERE account_id = p_account_id
    AND scheduled_monthly_retainer_cents IS NOT NULL
    AND scheduled_retainer_effective_at IS NOT NULL
    AND scheduled_retainer_effective_at <= now()
  RETURNING * INTO v_billing;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No scheduled retainer to apply';
  END IF;

  RETURN v_billing;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_account_amendment_revisions(p_amendment_id UUID)
RETURNS TABLE (
  id UUID,
  amendment_id UUID,
  revision_number INTEGER,
  account_name TEXT,
  monthly_retainer_cents INTEGER,
  currency TEXT,
  proposal_snapshot_json JSONB,
  agreement_type TEXT,
  terms_version TEXT,
  terms_snapshot_markdown TEXT,
  created_by_user_id UUID,
  created_by_user_name TEXT,
  created_at TIMESTAMPTZ,
  is_current BOOLEAN,
  is_published BOOLEAN,
  is_accepted BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amendment public.platform_account_amendments%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_amendment FROM public.platform_account_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment not found';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.amendment_id,
    r.revision_number,
    r.account_name,
    r.monthly_retainer_cents,
    r.currency,
    r.proposal_snapshot_json,
    r.agreement_type,
    r.terms_version,
    r.terms_snapshot_markdown,
    r.created_by_user_id,
    COALESCE(u.name, u.email, '') AS created_by_user_name,
    r.created_at,
    r.revision_number = v_amendment.current_revision_number AS is_current,
    r.revision_number = v_amendment.published_revision_number AS is_published,
    r.revision_number = v_amendment.accepted_revision_number AS is_accepted
  FROM public.platform_account_amendment_revisions r
  JOIN public.users u ON u.id = r.created_by_user_id
  WHERE r.amendment_id = p_amendment_id
  ORDER BY r.revision_number DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_account_amendments(p_account_id UUID)
RETURNS SETOF public.platform_account_amendments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.*
  FROM public.platform_account_amendments a
  WHERE a.account_id = p_account_id
    AND public.is_platform_admin()
  ORDER BY a.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.is_account_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_platform_account_amendment_draft(UUID, TEXT, INTEGER, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_account_amendment_draft(UUID, TEXT, INTEGER, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_platform_account_amendment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_platform_account_amendment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_platform_account_amendment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_account_amendment_info(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_platform_account_amendment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_account_amendment_revisions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_account_amendments(UUID) TO authenticated;

-- Seed contract snapshot when completing new invitations
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
      first_month_discount_cents = v_revision.first_month_discount_cents,
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
GRANT EXECUTE ON FUNCTION public.admin_update_account_billing(UUID, INTEGER, TEXT) TO authenticated;
