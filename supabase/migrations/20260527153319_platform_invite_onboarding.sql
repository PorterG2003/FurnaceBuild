-- ============================================
-- Platform invite onboarding, billing, and managed self-serve gating
-- ============================================

-- Platform proposal + terms versions
CREATE TABLE IF NOT EXISTS public.platform_terms_versions (
  version TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_terms_versions_default
  ON public.platform_terms_versions (is_default)
  WHERE is_default;

CREATE TRIGGER update_platform_terms_versions_updated_at
  BEFORE UPDATE ON public.platform_terms_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

INSERT INTO public.platform_terms_versions (version, title, body_markdown, is_default)
VALUES (
  'default-v1',
  'Service Proposal and Platform Terms',
  E'# Service Proposal and Platform Terms\n\nPlaceholder terms. Replace this version before production launch.',
  true
)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  invited_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pending_payment', 'active', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  proposed_account_name TEXT,
  monthly_retainer_cents INTEGER NOT NULL CHECK (monthly_retainer_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  first_month_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (first_month_discount_cents >= 0),
  proposal_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  terms_version TEXT NOT NULL REFERENCES public.platform_terms_versions(version) ON DELETE RESTRICT,
  terms_snapshot_markdown TEXT NOT NULL,
  terms_accepted_at TIMESTAMPTZ,
  terms_accepted_ip TEXT,
  accepted_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  prepared_full_name TEXT,
  prepared_account_name TEXT,
  auto_add_internal_admins BOOLEAN NOT NULL DEFAULT true,
  created_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  stripe_checkout_session_id TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  payment_completed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_invitations_email
  ON public.platform_invitations (lower(email));

CREATE INDEX IF NOT EXISTS idx_platform_invitations_status
  ON public.platform_invitations (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_invitations_pending_email
  ON public.platform_invitations (lower(email))
  WHERE status IN ('pending', 'pending_payment');

CREATE TRIGGER update_platform_invitations_updated_at
  BEFORE UPDATE ON public.platform_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.account_billing (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  monthly_retainer_cents INTEGER NOT NULL CHECK (monthly_retainer_cents > 0),
  billing_status TEXT NOT NULL DEFAULT 'active'
    CHECK (billing_status IN ('active', 'payment_required', 'canceled')),
  billing_anchor_day INTEGER NOT NULL DEFAULT 1 CHECK (billing_anchor_day BETWEEN 1 AND 31),
  frontend_access_blocked_at TIMESTAMPTZ,
  last_payment_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_billing_status
  ON public.account_billing (billing_status);

CREATE TRIGGER update_account_billing_updated_at
  BEFORE UPDATE ON public.account_billing
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.billing_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  billing_year INTEGER NOT NULL CHECK (billing_year >= 2024),
  billing_month INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  reason TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  stripe_coupon_id TEXT,
  stripe_invoice_item_id TEXT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, billing_year, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_billing_adjustments_account_id
  ON public.billing_adjustments (account_id, billing_year DESC, billing_month DESC);

CREATE TRIGGER update_billing_adjustments_updated_at
  BEFORE UPDATE ON public.billing_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.platform_terms_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_billing_select_member"
  ON public.account_billing
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_access_flags
    WHERE user_id = p_user_id
      AND flag_key = 'platform_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_platform_terms_version(p_version TEXT)
RETURNS public.platform_terms_versions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.platform_terms_versions
  WHERE version = p_version;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_terms_versions()
RETURNS SETOF public.platform_terms_versions
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
  SELECT *
  FROM public.platform_terms_versions
  ORDER BY is_default DESC, effective_at DESC, created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_terms_version(
  p_version TEXT,
  p_title TEXT,
  p_body_markdown TEXT,
  p_effective_at TIMESTAMPTZ DEFAULT now(),
  p_is_default BOOLEAN DEFAULT false
)
RETURNS public.platform_terms_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_terms_versions%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF COALESCE(trim(p_version), '') = '' THEN
    RAISE EXCEPTION 'Version is required';
  END IF;

  IF COALESCE(trim(p_title), '') = '' THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  IF COALESCE(trim(p_body_markdown), '') = '' THEN
    RAISE EXCEPTION 'Terms body is required';
  END IF;

  IF p_is_default THEN
    UPDATE public.platform_terms_versions
    SET is_default = false
    WHERE is_default = true;
  END IF;

  INSERT INTO public.platform_terms_versions (
    version,
    title,
    body_markdown,
    effective_at,
    is_default
  )
  VALUES (
    trim(p_version),
    trim(p_title),
    p_body_markdown,
    COALESCE(p_effective_at, now()),
    COALESCE(p_is_default, false)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_default_platform_terms_version(p_version TEXT)
RETURNS public.platform_terms_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_terms_versions%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.platform_terms_versions
  SET is_default = false
  WHERE is_default = true;

  UPDATE public.platform_terms_versions
  SET is_default = true,
      updated_at = now()
  WHERE version = p_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terms version not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_self_serve_guidance_info(p_email TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_known BOOLEAN := false;
BEGIN
  IF v_email = '' AND auth.uid() IS NOT NULL THEN
    SELECT lower(email)
    INTO v_email
    FROM auth.users
    WHERE id = auth.uid()
    LIMIT 1;
  END IF;

  IF COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object(
      'email', NULL,
      'is_known', false,
      'primary_cta', 'book_call'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_invitations pi
    WHERE lower(pi.email) = v_email
  ) OR EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.account_users au ON au.user_id = u.id
    WHERE lower(u.email) = v_email
  ) INTO v_known;

  RETURN jsonb_build_object(
    'email', v_email,
    'is_known', v_known,
    'primary_cta', CASE WHEN v_known THEN 'email_support' ELSE 'book_call' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_invitation(
  p_email TEXT,
  p_proposed_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
  p_first_month_discount_cents INTEGER DEFAULT 0,
  p_proposal_snapshot_json JSONB DEFAULT '{}'::jsonb,
  p_terms_version TEXT DEFAULT NULL,
  p_auto_add_internal_admins BOOLEAN DEFAULT true,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
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
  v_email TEXT := lower(trim(p_email));
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

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
  END IF;

  IF COALESCE(p_terms_version, '') = '' THEN
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE is_default = true
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

  INSERT INTO public.platform_invitations (
    email,
    invited_by_user_id,
    proposed_account_name,
    monthly_retainer_cents,
    currency,
    first_month_discount_cents,
    proposal_snapshot_json,
    terms_version,
    terms_snapshot_markdown,
    auto_add_internal_admins,
    expires_at
  )
  VALUES (
    v_email,
    v_uid,
    NULLIF(trim(COALESCE(p_proposed_account_name, '')), ''),
    p_monthly_retainer_cents,
    lower(trim(COALESCE(p_currency, 'usd'))),
    GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    v_terms.version,
    v_terms.body_markdown,
    COALESCE(p_auto_add_internal_admins, true),
    p_expires_at
  )
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_platform_invitation(p_invitation_id UUID)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.platform_invitations
  SET status = 'revoked',
      updated_at = now()
  WHERE id = p_invitation_id
    AND status <> 'active'
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or already active';
  END IF;

  RETURN v_inv;
END;
$$;

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
  first_month_discount_cents INTEGER,
  terms_version TEXT,
  created_account_id UUID,
  invited_by_user_name TEXT,
  accepted_by_user_name TEXT,
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
      WHEN pi.status = 'pending' AND pi.expires_at IS NOT NULL AND pi.expires_at < now() THEN 'expired'
      ELSE pi.status
    END AS status,
    pi.expires_at,
    pi.viewed_at,
    pi.proposed_account_name,
    pi.monthly_retainer_cents,
    pi.currency,
    pi.first_month_discount_cents,
    pi.terms_version,
    pi.created_account_id,
    COALESCE(NULLIF(inviter.name, ''), inviter.email) AS invited_by_user_name,
    COALESCE(NULLIF(invitee.name, ''), invitee.email) AS accepted_by_user_name,
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
  v_status TEXT;
BEGIN
  UPDATE public.platform_invitations
  SET viewed_at = COALESCE(viewed_at, now())
  WHERE id = p_invitation_id
    AND viewed_at IS NULL;

  SELECT
    pi.id,
    pi.email,
    pi.status,
    pi.expires_at,
    pi.proposed_account_name,
    pi.monthly_retainer_cents,
    pi.currency,
    pi.first_month_discount_cents,
    pi.proposal_snapshot_json,
    pi.terms_version,
    pi.terms_snapshot_markdown,
    pi.viewed_at,
    COALESCE(NULLIF(u.name, ''), u.email) AS inviter_name
  INTO v_inv
  FROM public.platform_invitations pi
  JOIN public.users u ON u.id = pi.invited_by_user_id
  WHERE pi.id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_status := v_inv.status;
  IF v_status = 'pending' AND v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    UPDATE public.platform_invitations
    SET status = 'expired',
        updated_at = now()
    WHERE id = p_invitation_id
      AND status = 'pending';
    v_status := 'expired';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'invitee_email', v_inv.email,
    'expires_at', v_inv.expires_at,
    'proposed_account_name', v_inv.proposed_account_name,
    'monthly_retainer_cents', v_inv.monthly_retainer_cents,
    'currency', v_inv.currency,
    'first_month_discount_cents', v_inv.first_month_discount_cents,
    'proposal_snapshot', COALESCE(v_inv.proposal_snapshot_json, '{}'::jsonb),
    'terms_version', v_inv.terms_version,
    'terms_snapshot_markdown', v_inv.terms_snapshot_markdown,
    'inviter_name', v_inv.inviter_name,
    'viewed_at', v_inv.viewed_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_invitation_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_platform_invitation_info(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_platform_invitation_checkout(
  p_invitation_id UUID,
  p_full_name TEXT,
  p_account_name TEXT,
  p_terms_accepted_ip TEXT DEFAULT NULL
)
RETURNS public.platform_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(email) INTO v_email
  FROM auth.users
  WHERE id = v_uid;

  UPDATE public.platform_invitations
  SET accepted_by_user_id = v_uid,
      prepared_full_name = NULLIF(trim(COALESCE(p_full_name, '')), ''),
      prepared_account_name = NULLIF(trim(COALESCE(p_account_name, '')), ''),
      terms_accepted_at = now(),
      terms_accepted_ip = COALESCE(p_terms_accepted_ip, terms_accepted_ip),
      status = 'pending_payment',
      updated_at = now()
  WHERE id = p_invitation_id
    AND lower(email) = COALESCE(v_email, '')
    AND status IN ('pending', 'pending_payment')
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or email mismatch';
  END IF;

  IF v_inv.prepared_full_name IS NULL OR v_inv.prepared_account_name IS NULL THEN
    RAISE EXCEPTION 'Full name and account name are required';
  END IF;

  UPDATE public.users
  SET name = v_inv.prepared_full_name,
      updated_at = now()
  WHERE id = v_uid;

  RETURN v_inv;
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
  v_account_id UUID;
  v_internal_email TEXT;
  v_internal_user_id UUID;
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

  INSERT INTO public.accounts (name, created_at, updated_at)
  VALUES (
    COALESCE(v_inv.prepared_account_name, v_inv.proposed_account_name, split_part(v_inv.email, '@', 1) || '''s Account'),
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
    billing_anchor_day
  )
  VALUES (
    v_account_id,
    NULLIF(trim(COALESCE(p_stripe_customer_id, '')), ''),
    NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), ''),
    v_inv.monthly_retainer_cents,
    'active',
    1
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
      stripe_checkout_session_id = NULLIF(trim(COALESCE(p_stripe_checkout_session_id, '')), ''),
      stripe_customer_id = NULLIF(trim(COALESCE(p_stripe_customer_id, '')), ''),
      stripe_subscription_id = NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), ''),
      payment_completed_at = now(),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_invitation_id;

  RETURN jsonb_build_object(
    'status', 'completed',
    'account_id', v_account_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_billing_adjustment(
  p_account_id UUID,
  p_billing_year INTEGER,
  p_billing_month INTEGER,
  p_discount_cents INTEGER,
  p_reason TEXT
)
RETURNS public.billing_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.billing_adjustments%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.billing_adjustments (
    account_id,
    billing_year,
    billing_month,
    discount_cents,
    reason,
    created_by_user_id
  )
  VALUES (
    p_account_id,
    p_billing_year,
    p_billing_month,
    p_discount_cents,
    p_reason,
    v_uid
  )
  ON CONFLICT (account_id, billing_year, billing_month)
  DO UPDATE SET
    discount_cents = EXCLUDED.discount_cents,
    reason = EXCLUDED.reason,
    created_by_user_id = EXCLUDED.created_by_user_id,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_billing_adjustments(p_account_id UUID DEFAULT NULL)
RETURNS SETOF public.billing_adjustments
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
  SELECT *
  FROM public.billing_adjustments
  WHERE p_account_id IS NULL OR account_id = p_account_id
  ORDER BY billing_year DESC, billing_month DESC, created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_account_billing()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  monthly_retainer_cents INTEGER,
  billing_status TEXT,
  frontend_access_blocked_at TIMESTAMPTZ,
  last_payment_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
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
    ab.account_id,
    a.name,
    ab.stripe_customer_id,
    ab.stripe_subscription_id,
    ab.monthly_retainer_cents,
    ab.billing_status,
    ab.frontend_access_blocked_at,
    ab.last_payment_failed_at,
    ab.created_at,
    ab.updated_at
  FROM public.account_billing ab
  JOIN public.accounts a ON a.id = ab.account_id
  ORDER BY a.updated_at DESC, a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_account_billing_status(
  p_account_id UUID,
  p_billing_status TEXT
)
RETURNS public.account_billing
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.account_billing%ROWTYPE;
BEGIN
  UPDATE public.account_billing
  SET billing_status = p_billing_status,
      frontend_access_blocked_at = CASE WHEN p_billing_status = 'payment_required' THEN now() ELSE NULL END,
      last_payment_failed_at = CASE WHEN p_billing_status = 'payment_required' THEN now() ELSE last_payment_failed_at END,
      updated_at = now()
  WHERE account_id = p_account_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing row not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_account(p_account_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Self-serve account creation is disabled. Use a platform invite.';
  END IF;

  RAISE EXCEPTION 'bootstrap_account is reserved for internal use only';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_terms_version(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_terms_versions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_platform_terms_version(TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_platform_terms_version(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_platform_invitation(TEXT, TEXT, INTEGER, TEXT, INTEGER, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_platform_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_self_serve_guidance_info(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_self_serve_guidance_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_platform_invitation_checkout(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_platform_invitation(UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_billing_adjustment(UUID, INTEGER, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_billing_adjustments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_account_billing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_billing_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;
