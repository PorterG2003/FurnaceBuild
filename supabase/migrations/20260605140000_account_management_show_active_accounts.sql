-- Active clients were hidden as account rows when their invite stayed status=active.
-- Show account rows for operational management; hide the redundant active invite row.

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
    WHERE pa.account_id = a.id AND pa.status = 'pending_acceptance'
    ORDER BY pa.published_at DESC NULLS LAST
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
