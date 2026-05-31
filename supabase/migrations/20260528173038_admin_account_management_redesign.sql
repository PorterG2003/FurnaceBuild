-- ============================================
-- Admin account management draft, revision, and unified pipeline workflow
-- ============================================

CREATE TABLE IF NOT EXISTS public.platform_invitation_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES public.platform_invitations(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  email TEXT NOT NULL,
  proposed_account_name TEXT,
  monthly_retainer_cents INTEGER NOT NULL CHECK (monthly_retainer_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  first_month_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (first_month_discount_cents >= 0),
  proposal_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  terms_version TEXT NOT NULL REFERENCES public.platform_terms_versions(version) ON DELETE RESTRICT,
  terms_snapshot_markdown TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invitation_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_platform_invitation_revisions_invitation
  ON public.platform_invitation_revisions (invitation_id, revision_number DESC);

ALTER TABLE public.platform_invitation_revisions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS current_revision_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS published_revision_number INTEGER,
  ADD COLUMN IF NOT EXISTS checkout_revision_number INTEGER,
  ADD COLUMN IF NOT EXISTS accepted_revision_number INTEGER,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMPTZ;

ALTER TABLE public.platform_invitations
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_status_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_status_check
  CHECK (
    status IN (
      'draft',
      'approved',
      'sent',
      'pending',
      'pending_payment',
      'active',
      'expired',
      'revoked'
    )
  );

DROP INDEX IF EXISTS idx_platform_invitations_pending_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_invitations_open_email
  ON public.platform_invitations (lower(email))
  WHERE status IN ('draft', 'approved', 'sent', 'pending', 'pending_payment');

INSERT INTO public.platform_invitation_revisions (
  invitation_id,
  revision_number,
  email,
  proposed_account_name,
  monthly_retainer_cents,
  currency,
  first_month_discount_cents,
  proposal_snapshot_json,
  terms_version,
  terms_snapshot_markdown,
  created_by_user_id,
  created_at
)
SELECT
  pi.id,
  1,
  pi.email,
  pi.proposed_account_name,
  pi.monthly_retainer_cents,
  pi.currency,
  pi.first_month_discount_cents,
  COALESCE(pi.proposal_snapshot_json, '{}'::jsonb),
  pi.terms_version,
  pi.terms_snapshot_markdown,
  pi.invited_by_user_id,
  pi.created_at
FROM public.platform_invitations pi
WHERE NOT EXISTS (
  SELECT 1
  FROM public.platform_invitation_revisions pir
  WHERE pir.invitation_id = pi.id
);

UPDATE public.platform_invitations pi
SET
  current_revision_number = COALESCE(pi.current_revision_number, 1),
  published_revision_number = CASE
    WHEN pi.published_revision_number IS NOT NULL THEN pi.published_revision_number
    WHEN pi.status IN ('pending', 'pending_payment', 'active', 'expired', 'revoked') THEN 1
    ELSE NULL
  END,
  checkout_revision_number = CASE
    WHEN pi.checkout_revision_number IS NOT NULL THEN pi.checkout_revision_number
    WHEN pi.status = 'pending_payment' THEN 1
    ELSE NULL
  END,
  accepted_revision_number = CASE
    WHEN pi.accepted_revision_number IS NOT NULL THEN pi.accepted_revision_number
    WHEN pi.status = 'active' THEN 1
    ELSE NULL
  END,
  sent_at = CASE
    WHEN pi.sent_at IS NOT NULL THEN pi.sent_at
    WHEN pi.status IN ('pending', 'pending_payment', 'active', 'expired', 'revoked') THEN pi.created_at
    ELSE NULL
  END,
  last_email_sent_at = CASE
    WHEN pi.last_email_sent_at IS NOT NULL THEN pi.last_email_sent_at
    WHEN pi.status IN ('pending', 'pending_payment', 'active', 'expired', 'revoked') THEN pi.created_at
    ELSE NULL
  END
WHERE true;

CREATE OR REPLACE FUNCTION public.create_platform_invitation_draft(
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
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
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
    status,
    proposed_account_name,
    monthly_retainer_cents,
    currency,
    first_month_discount_cents,
    proposal_snapshot_json,
    terms_version,
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
    GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    v_terms.version,
    v_terms.body_markdown,
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
    first_month_discount_cents,
    proposal_snapshot_json,
    terms_version,
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
    v_inv.first_month_discount_cents,
    v_inv.proposal_snapshot_json,
    v_inv.terms_version,
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
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
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

  IF v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
  END IF;

  IF COALESCE(p_terms_version, '') = '' THEN
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE version = v_inv.terms_version;
  ELSE
    SELECT * INTO v_terms
    FROM public.platform_terms_versions
    WHERE version = p_terms_version;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terms version not found';
  END IF;

  v_next_revision := COALESCE(v_inv.current_revision_number, 0) + 1;

  INSERT INTO public.platform_invitation_revisions (
    invitation_id,
    revision_number,
    email,
    proposed_account_name,
    monthly_retainer_cents,
    currency,
    first_month_discount_cents,
    proposal_snapshot_json,
    terms_version,
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
    GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    v_terms.version,
    v_terms.body_markdown,
    v_uid,
    now()
  );

  UPDATE public.platform_invitations
  SET
    email = v_email,
    proposed_account_name = NULLIF(trim(COALESCE(p_proposed_account_name, '')), ''),
    monthly_retainer_cents = p_monthly_retainer_cents,
    currency = lower(trim(COALESCE(p_currency, 'usd'))),
    first_month_discount_cents = GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    proposal_snapshot_json = COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    terms_version = v_terms.version,
    terms_snapshot_markdown = v_terms.body_markdown,
    auto_add_internal_admins = COALESCE(p_auto_add_internal_admins, true),
    expires_at = p_expires_at,
    current_revision_number = v_next_revision,
    status = 'draft',
    approved_at = NULL,
    updated_at = now()
  WHERE id = p_invitation_id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_platform_invitation_ready(p_invitation_id UUID)
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
  SET
    status = 'approved',
    approved_at = now(),
    updated_at = now()
  WHERE id = p_invitation_id
    AND status IN ('draft', 'approved', 'sent', 'pending')
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or cannot be marked ready';
  END IF;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_platform_invitation(p_invitation_id UUID)
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
  SET
    status = 'sent',
    published_revision_number = current_revision_number,
    checkout_revision_number = NULL,
    approved_at = COALESCE(approved_at, now()),
    sent_at = COALESCE(sent_at, now()),
    last_email_sent_at = now(),
    updated_at = now()
  WHERE id = p_invitation_id
    AND status IN ('draft', 'approved', 'sent', 'pending')
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or cannot be published';
  END IF;

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_invitation_revisions(p_invitation_id UUID)
RETURNS TABLE (
  id UUID,
  revision_number INTEGER,
  email TEXT,
  proposed_account_name TEXT,
  monthly_retainer_cents INTEGER,
  currency TEXT,
  first_month_discount_cents INTEGER,
  proposal_snapshot_json JSONB,
  terms_version TEXT,
  terms_snapshot_markdown TEXT,
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
    pir.first_month_discount_cents,
    pir.proposal_snapshot_json,
    pir.terms_version,
    pir.terms_snapshot_markdown,
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

CREATE OR REPLACE FUNCTION public.list_platform_account_management_records()
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
    'invitation'::TEXT AS record_kind,
    pi.id AS record_id,
    pi.id AS invitation_id,
    pi.created_account_id AS account_id,
    CASE
      WHEN pi.status IN ('draft', 'approved', 'sent', 'pending')
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
    pi.updated_at
  FROM public.platform_invitations pi
  LEFT JOIN public.accounts a ON a.id = pi.created_account_id
  LEFT JOIN public.account_billing ab ON ab.account_id = pi.created_account_id

  UNION ALL

  SELECT
    'account'::TEXT AS record_kind,
    a.id AS record_id,
    NULL::UUID AS invitation_id,
    a.id AS account_id,
    'active'::TEXT AS lifecycle_status,
    'Legacy account'::TEXT AS revision_state,
    a.name AS display_name,
    owner.email AS primary_email,
    ab.monthly_retainer_cents,
    ab.billing_status,
    NULL::INTEGER AS current_revision_number,
    NULL::INTEGER AS published_revision_number,
    NULL::INTEGER AS accepted_revision_number,
    NULL::TIMESTAMPTZ AS sent_at,
    COALESCE(ab.updated_at, a.updated_at) AS last_activity_at,
    COALESCE(ab.updated_at, a.updated_at) AS updated_at
  FROM public.accounts a
  JOIN public.account_billing ab ON ab.account_id = a.id
  LEFT JOIN LATERAL (
    SELECT u.email
    FROM public.account_users au
    JOIN public.users u ON u.id = au.user_id
    WHERE au.account_id = a.id
    ORDER BY au.is_owner DESC, au.created_at ASC
    LIMIT 1
  ) owner ON true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.platform_invitations pi
    WHERE pi.created_account_id = a.id
  )

  ORDER BY updated_at DESC, last_activity_at DESC NULLS LAST;
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
  v_inv public.platform_invitations%ROWTYPE;
BEGIN
  v_inv := public.create_platform_invitation_draft(
    p_email,
    p_proposed_account_name,
    p_monthly_retainer_cents,
    p_currency,
    p_first_month_discount_cents,
    p_proposal_snapshot_json,
    p_terms_version,
    p_auto_add_internal_admins,
    p_expires_at
  );

  UPDATE public.platform_invitations
  SET
    status = 'pending',
    published_revision_number = current_revision_number,
    approved_at = now(),
    sent_at = now(),
    updated_at = now()
  WHERE id = v_inv.id
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

DROP FUNCTION IF EXISTS public.list_platform_invitations();

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
  current_revision_number INTEGER,
  published_revision_number INTEGER,
  accepted_revision_number INTEGER,
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
      WHEN pi.status IN ('draft', 'approved', 'sent', 'pending')
        AND pi.expires_at IS NOT NULL
        AND pi.expires_at < now()
      THEN 'expired'
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
    pi.current_revision_number,
    pi.published_revision_number,
    pi.accepted_revision_number,
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
    pir.terms_version,
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
    'terms_version', v_revision.terms_version,
    'terms_snapshot_markdown', v_revision.terms_snapshot_markdown,
    'inviter_name', v_inv.inviter_name,
    'viewed_at', v_inv.viewed_at,
    'published_revision_number', v_inv.published_revision_number,
    'active_revision_number', v_live_revision_number
  );
END;
$$;

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
      checkout_revision_number = COALESCE(published_revision_number, current_revision_number),
      status = 'pending_payment',
      updated_at = now()
  WHERE id = p_invitation_id
    AND lower(email) = COALESCE(v_email, '')
    AND COALESCE(published_revision_number, current_revision_number) IS NOT NULL
    AND status IN ('sent', 'pending', 'pending_payment')
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
    billing_anchor_day
  )
  VALUES (
    v_account_id,
    NULLIF(trim(COALESCE(p_stripe_customer_id, '')), ''),
    NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), ''),
    v_revision.monthly_retainer_cents,
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
      email = v_revision.email,
      proposed_account_name = v_revision.proposed_account_name,
      monthly_retainer_cents = v_revision.monthly_retainer_cents,
      currency = v_revision.currency,
      first_month_discount_cents = v_revision.first_month_discount_cents,
      proposal_snapshot_json = v_revision.proposal_snapshot_json,
      terms_version = v_revision.terms_version,
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

GRANT EXECUTE ON FUNCTION public.create_platform_invitation_draft(TEXT, TEXT, INTEGER, TEXT, INTEGER, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_invitation_draft(UUID, TEXT, TEXT, INTEGER, TEXT, INTEGER, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_platform_invitation_ready(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_platform_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_invitation_revisions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_account_management_records() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_account_management_detail(UUID, TEXT) TO authenticated;
