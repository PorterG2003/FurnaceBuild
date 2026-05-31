-- ============================================
-- Platform invite terms templates, agreement types, and rendered snapshots
-- ============================================

ALTER TABLE public.platform_terms_versions
  ADD COLUMN IF NOT EXISTS agreement_type TEXT NOT NULL DEFAULT 'platform_agreement'
    CHECK (agreement_type IN ('platform_agreement', 'managed_services_agreement'));

ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS agreement_type TEXT NOT NULL DEFAULT 'platform_agreement'
    CHECK (agreement_type IN ('platform_agreement', 'managed_services_agreement')),
  ADD COLUMN IF NOT EXISTS terms_source_markdown TEXT;

ALTER TABLE public.platform_invitation_revisions
  ADD COLUMN IF NOT EXISTS agreement_type TEXT NOT NULL DEFAULT 'platform_agreement'
    CHECK (agreement_type IN ('platform_agreement', 'managed_services_agreement')),
  ADD COLUMN IF NOT EXISTS terms_source_markdown TEXT;

UPDATE public.platform_invitations
SET terms_source_markdown = terms_snapshot_markdown
WHERE terms_source_markdown IS NULL;

UPDATE public.platform_invitation_revisions
SET terms_source_markdown = terms_snapshot_markdown
WHERE terms_source_markdown IS NULL;

ALTER TABLE public.platform_invitations
  ALTER COLUMN terms_source_markdown SET NOT NULL;

ALTER TABLE public.platform_invitation_revisions
  ALTER COLUMN terms_source_markdown SET NOT NULL;

DROP INDEX IF EXISTS idx_platform_terms_versions_default;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_terms_versions_default_by_type
  ON public.platform_terms_versions (agreement_type)
  WHERE is_default;

CREATE OR REPLACE FUNCTION public.format_platform_terms_mst_date(
  p_reference TIMESTAMPTZ DEFAULT now()
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(timezone('MST', COALESCE(p_reference, now())), 'FMMonth FMDD, YYYY');
$$;

CREATE OR REPLACE FUNCTION public.format_platform_terms_currency(
  p_cents INTEGER DEFAULT 0
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT to_char((COALESCE(p_cents, 0)::numeric / 100), 'FM$999,999,999,990');
$$;

CREATE OR REPLACE FUNCTION public.render_platform_terms_markdown(
  p_source_markdown TEXT,
  p_proposed_account_name TEXT DEFAULT NULL,
  p_monthly_retainer_cents INTEGER DEFAULT 0,
  p_proposal_snapshot_json JSONB DEFAULT '{}'::jsonb,
  p_rendered_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_rendered TEXT := COALESCE(p_source_markdown, '');
  v_client_name TEXT := COALESCE(NULLIF(trim(COALESCE(p_proposed_account_name, '')), ''), 'Client');
  v_mst_date TEXT := public.format_platform_terms_mst_date(COALESCE(p_rendered_at, now()));
  v_outreach_volume TEXT := NULLIF(trim(COALESCE(p_proposal_snapshot_json->>'managed_outreach_volume', '')), '');
  v_inbox_count TEXT := NULLIF(trim(COALESCE(p_proposal_snapshot_json->>'managed_inbox_count', '')), '');
BEGIN
  IF v_outreach_volume ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_outreach_volume := trim(to_char(v_outreach_volume::numeric, 'FM999,999,999,990'));
  END IF;

  IF v_inbox_count ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_inbox_count := trim(to_char(v_inbox_count::numeric, 'FM999,999,999,990'));
  END IF;

  v_rendered := replace(v_rendered, '{{client_name}}', v_client_name);
  v_rendered := replace(v_rendered, '{{monthly_fee}}', public.format_platform_terms_currency(p_monthly_retainer_cents));
  v_rendered := replace(v_rendered, '{{effective_date_mst}}', v_mst_date);
  v_rendered := replace(v_rendered, '{{start_date_mst}}', v_mst_date);
  v_rendered := replace(v_rendered, '{{outreach_volume}}', COALESCE(v_outreach_volume, 'TBD'));
  v_rendered := replace(v_rendered, '{{inbox_count}}', COALESCE(v_inbox_count, 'TBD'));

  RETURN v_rendered;
END;
$$;

UPDATE public.platform_terms_versions
SET
  agreement_type = 'platform_agreement',
  title = 'Platform Agreement',
  body_markdown = $platform_template$
# Furnace Platform Agreement

Last updated: June 1, 2025

By creating an account, accessing Furnace, or using the platform in any way, you agree to this Platform Agreement. If you do not agree, do not use Furnace.

## 1. Platform overview

Furnace provides a software platform for running cold email outreach campaigns. The platform lets you manage contact lists, build and send sequences, monitor campaign performance, and use related outreach tools. You are responsible for the campaigns you run through the platform.

## 2. Account registration and eligibility

To use Furnace, you must create an account with accurate and complete information. You represent that:

- you are at least 18 years old and have authority to enter into this agreement
- your registration information is accurate and stays up to date
- you are responsible for your account credentials and all activity under your account
- you will promptly notify Furnace of any unauthorized account access

## 3. Subscription and payment

### 3.1 Monthly subscription

Platform access is billed monthly. Your first invoice is due when the account is activated. Ongoing invoices are issued on the 1st of each calendar month, or the next business day when needed.

### 3.2 Prorated billing

If your account activates mid-month, your second invoice will be prorated to cover the remainder of that calendar month. Standard monthly billing begins the following month.

### 3.3 Late payments

Invoices are due upon receipt. Payments more than ten (10) days late incur a $20 late fee. Furnace may suspend platform access for overdue accounts.

## 4. Acceptable use

You agree to use Furnace only for lawful outreach purposes. You may not:

- upload or use contact data obtained unlawfully or in violation of third-party rights
- use the platform in ways that violate the rights, privacy, or dignity of any person
- reverse engineer, copy, or extract Furnace systems, algorithms, or methodologies
- interfere with the platform's infrastructure or security
- misrepresent your identity or affiliation in outreach sent through the platform

## 5. Compliance

### 5.1 Your responsibility

You are solely responsible for ensuring that your use of Furnace, including contact data, email content, and targeting decisions, complies with all applicable laws and regulations, including CAN-SPAM, CASL, GDPR, and other applicable privacy or anti-spam laws.

### 5.2 Furnace guidance

Furnace may provide compliance guidance, best practices, or platform safeguards to help you send responsibly. That guidance is not legal advice and does not shift compliance responsibility to Furnace. You are responsible for obtaining your own legal advice when needed.

### 5.3 Data sourcing

You represent and warrant that all prospect data uploaded to the platform was obtained lawfully and with all required permissions. Furnace is not responsible for the origin or legality of data you supply.

## 6. Data ownership and privacy

### 6.1 Your data

You retain ownership of all prospect data, contact lists, and related information you provide to or import into Furnace ("Client Data"). Furnace will not sell or disclose Client Data in any way that could reasonably identify you or your prospect relationships.

### 6.2 Platform license

You grant Furnace a perpetual, irrevocable, royalty-free license to store and use Client Data in transformed form solely for internal purposes, including platform operation, maintenance, improvement, and AI or machine-learning model training. This license survives termination.

### 6.3 Campaign performance data

Campaign performance data generated through your use of the platform, including open rates, reply rates, sequence performance, and deliverability metrics, is owned by you. Furnace may retain anonymized, non-attributable derivatives for internal platform improvement.

### 6.4 Aggregate use

Furnace may use anonymized, aggregated insights from campaign data for benchmarks, product development, and published statistics, provided that use cannot reasonably identify you, your prospects, or your campaign strategies.

### 6.5 Furnace-supplied data

If Furnace makes prospect lists or contact data available through the platform ("Furnace Data"), that data remains Furnace property. You receive a limited, non-exclusive, non-transferable license to use Furnace Data for legitimate business purposes. Leads or qualified prospects generated from Furnace Data are owned by you, but the underlying Furnace Data is not transferred.

## 7. Intellectual property

Furnace retains exclusive ownership of the platform and all associated technology, including outreach systems, automation tools, infrastructure, algorithms, and proprietary methodologies. This agreement gives you only the limited right to use Furnace as described here.

Email templates you create remain yours and may be used after termination. You may not replicate or use Furnace systems or processes outside the platform.

## 8. Term and termination

This agreement starts when you create your account and continues month to month unless terminated. Either party may terminate with fourteen (14) days' written notice. Either party may terminate immediately for a material breach by the other party.

When this agreement ends, platform access ends at the close of the current billing period, or immediately in the event of material breach. You may export Client Data and leads generated during your engagement before termination.

## 9. Confidentiality

Both parties will keep confidential any proprietary information exchanged under this agreement during the term and for one (1) year after termination. Furnace will not share your strategies, campaign data, or client-specific insights with other users.

## 10. Indemnification

You agree to indemnify, defend, and hold harmless Furnace and its officers, employees, and agents from claims, losses, liabilities, and expenses arising from your use of the platform, including claims related to your outreach campaigns, data practices, or compliance failures. Furnace will indemnify you for claims arising from Furnace's gross negligence or willful misconduct.

## 11. Disclaimer of warranties

The platform is provided "as is" and "as available" without warranties of any kind, express or implied. Furnace does not warrant that the platform will be uninterrupted, error-free, or free of harmful components.

## 12. Limitation of liability

To the maximum extent permitted by law, Furnace is not liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the platform. Furnace's total liability will not exceed the amounts you paid Furnace in the three (3) months before the claim.

## 13. Changes to this agreement

Furnace may update this agreement from time to time. Material changes will be shared by email or in-product notice. Continued use of the platform after the effective date of an update means you accept the revised agreement.

## 14. Governing law

This agreement is governed by the laws of the State of Utah, without regard to conflict-of-law rules. The parties consent to exclusive jurisdiction and venue in the state and federal courts located in Utah.

## 15. Entire agreement

This agreement is the entire understanding between you and Furnace regarding the platform and supersedes prior agreements or understandings on that subject.
$platform_template$,
  is_default = false,
  updated_at = now()
WHERE version = 'default-v1';

INSERT INTO public.platform_terms_versions (
  version,
  agreement_type,
  title,
  body_markdown,
  effective_at,
  is_default
)
VALUES (
  'platform-agreement-current',
  'platform_agreement',
  'Platform Agreement',
  $platform_template$
# Furnace Platform Agreement

Last updated: June 1, 2025

By creating an account, accessing Furnace, or using the platform in any way, you agree to this Platform Agreement. If you do not agree, do not use Furnace.

## 1. Platform overview

Furnace provides a software platform for running cold email outreach campaigns. The platform lets you manage contact lists, build and send sequences, monitor campaign performance, and use related outreach tools. You are responsible for the campaigns you run through the platform.

## 2. Account registration and eligibility

To use Furnace, you must create an account with accurate and complete information. You represent that:

- you are at least 18 years old and have authority to enter into this agreement
- your registration information is accurate and stays up to date
- you are responsible for your account credentials and all activity under your account
- you will promptly notify Furnace of any unauthorized account access

## 3. Subscription and payment

### 3.1 Monthly subscription

Platform access is billed monthly. Your first invoice is due when the account is activated. Ongoing invoices are issued on the 1st of each calendar month, or the next business day when needed.

### 3.2 Prorated billing

If your account activates mid-month, your second invoice will be prorated to cover the remainder of that calendar month. Standard monthly billing begins the following month.

### 3.3 Late payments

Invoices are due upon receipt. Payments more than ten (10) days late incur a $20 late fee. Furnace may suspend platform access for overdue accounts.

## 4. Acceptable use

You agree to use Furnace only for lawful outreach purposes. You may not:

- upload or use contact data obtained unlawfully or in violation of third-party rights
- use the platform in ways that violate the rights, privacy, or dignity of any person
- reverse engineer, copy, or extract Furnace systems, algorithms, or methodologies
- interfere with the platform's infrastructure or security
- misrepresent your identity or affiliation in outreach sent through the platform

## 5. Compliance

### 5.1 Your responsibility

You are solely responsible for ensuring that your use of Furnace, including contact data, email content, and targeting decisions, complies with all applicable laws and regulations, including CAN-SPAM, CASL, GDPR, and other applicable privacy or anti-spam laws.

### 5.2 Furnace guidance

Furnace may provide compliance guidance, best practices, or platform safeguards to help you send responsibly. That guidance is not legal advice and does not shift compliance responsibility to Furnace. You are responsible for obtaining your own legal advice when needed.

### 5.3 Data sourcing

You represent and warrant that all prospect data uploaded to the platform was obtained lawfully and with all required permissions. Furnace is not responsible for the origin or legality of data you supply.

## 6. Data ownership and privacy

### 6.1 Your data

You retain ownership of all prospect data, contact lists, and related information you provide to or import into Furnace ("Client Data"). Furnace will not sell or disclose Client Data in any way that could reasonably identify you or your prospect relationships.

### 6.2 Platform license

You grant Furnace a perpetual, irrevocable, royalty-free license to store and use Client Data in transformed form solely for internal purposes, including platform operation, maintenance, improvement, and AI or machine-learning model training. This license survives termination.

### 6.3 Campaign performance data

Campaign performance data generated through your use of the platform, including open rates, reply rates, sequence performance, and deliverability metrics, is owned by you. Furnace may retain anonymized, non-attributable derivatives for internal platform improvement.

### 6.4 Aggregate use

Furnace may use anonymized, aggregated insights from campaign data for benchmarks, product development, and published statistics, provided that use cannot reasonably identify you, your prospects, or your campaign strategies.

### 6.5 Furnace-supplied data

If Furnace makes prospect lists or contact data available through the platform ("Furnace Data"), that data remains Furnace property. You receive a limited, non-exclusive, non-transferable license to use Furnace Data for legitimate business purposes. Leads or qualified prospects generated from Furnace Data are owned by you, but the underlying Furnace Data is not transferred.

## 7. Intellectual property

Furnace retains exclusive ownership of the platform and all associated technology, including outreach systems, automation tools, infrastructure, algorithms, and proprietary methodologies. This agreement gives you only the limited right to use Furnace as described here.

Email templates you create remain yours and may be used after termination. You may not replicate or use Furnace systems or processes outside the platform.

## 8. Term and termination

This agreement starts when you create your account and continues month to month unless terminated. Either party may terminate with fourteen (14) days' written notice. Either party may terminate immediately for a material breach by the other party.

When this agreement ends, platform access ends at the close of the current billing period, or immediately in the event of material breach. You may export Client Data and leads generated during your engagement before termination.

## 9. Confidentiality

Both parties will keep confidential any proprietary information exchanged under this agreement during the term and for one (1) year after termination. Furnace will not share your strategies, campaign data, or client-specific insights with other users.

## 10. Indemnification

You agree to indemnify, defend, and hold harmless Furnace and its officers, employees, and agents from claims, losses, liabilities, and expenses arising from your use of the platform, including claims related to your outreach campaigns, data practices, or compliance failures. Furnace will indemnify you for claims arising from Furnace's gross negligence or willful misconduct.

## 11. Disclaimer of warranties

The platform is provided "as is" and "as available" without warranties of any kind, express or implied. Furnace does not warrant that the platform will be uninterrupted, error-free, or free of harmful components.

## 12. Limitation of liability

To the maximum extent permitted by law, Furnace is not liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the platform. Furnace's total liability will not exceed the amounts you paid Furnace in the three (3) months before the claim.

## 13. Changes to this agreement

Furnace may update this agreement from time to time. Material changes will be shared by email or in-product notice. Continued use of the platform after the effective date of an update means you accept the revised agreement.

## 14. Governing law

This agreement is governed by the laws of the State of Utah, without regard to conflict-of-law rules. The parties consent to exclusive jurisdiction and venue in the state and federal courts located in Utah.

## 15. Entire agreement

This agreement is the entire understanding between you and Furnace regarding the platform and supersedes prior agreements or understandings on that subject.
$platform_template$,
  now(),
  true
)
ON CONFLICT (version) DO UPDATE
SET
  agreement_type = EXCLUDED.agreement_type,
  title = EXCLUDED.title,
  body_markdown = EXCLUDED.body_markdown,
  is_default = EXCLUDED.is_default,
  updated_at = now();

INSERT INTO public.platform_terms_versions (
  version,
  agreement_type,
  title,
  body_markdown,
  effective_at,
  is_default
)
VALUES (
  'managed-services-agreement-current',
  'managed_services_agreement',
  'Managed Services Agreement',
  $managed_template$
# Furnace Managed Services Agreement

Last updated: June 1, 2025

This Managed Services Agreement covers Furnace's done-for-you cold email outreach services for {{client_name}}. The effective date and service start date are {{effective_date_mst}}.

By accepting this invite and completing payment, Client agrees to this Managed Services Agreement.

## 1. Scope of services

Furnace will provide fully managed cold email outreach services on Client's behalf, which may include:

- developing and executing personalized outreach campaigns
- managing sending, deliverability, inbox workflows, and performance optimization
- providing platform access for visibility and reporting
- sourcing prospect lists and contact data where applicable

The current managed-services scope is:

- outreach volume: {{outreach_volume}} emails per month
- sending inboxes: {{inbox_count}}
- service start date: {{start_date_mst}}

## 2. Compensation and payment

### 2.1 Fees

Client agrees to pay Furnace a monthly retainer of {{monthly_fee}} for the duration of this agreement.

### 2.2 Invoicing

The initial invoice of {{monthly_fee}} is due when this agreement is accepted. Subsequent invoices are issued on the 1st of each calendar month, or the next business day when needed. If a billing period begins mid-month, the second invoice is prorated accordingly.

### 2.3 Late payments

Invoices are due upon receipt. Payments more than ten (10) days late incur a $20 late fee. Furnace may pause or suspend services for overdue accounts.

## 3. Compliance

### 3.1 Furnace compliance responsibility

Furnace assumes responsibility for compliance with applicable email sending laws and regulations, including CAN-SPAM and CASL, for outreach campaigns Furnace runs on Client's behalf. That includes opt-out handling, sender identification requirements, and applicable sending restrictions.

### 3.2 Client-supplied data

If Client supplies prospect lists or contact data, Client represents and warrants that the data was obtained lawfully and in compliance with applicable law. Furnace's compliance obligations apply to Furnace's use of that data, not to its original sourcing or acquisition by Client.

### 3.3 Client account actions

Client may access and make changes to campaigns, sequences, contacts, and settings through the Furnace account at any time. Furnace is not responsible for actions Client takes directly in the account, including campaign edits, contact-list changes, or sending-setting adjustments. Client is responsible for the consequences of those direct actions.

## 4. Data ownership and privacy

### 4.1 Client data

Client retains ownership of all prospect data, contact lists, and related information provided to or imported into Furnace ("Client Data"). Furnace will not sell or disclose Client Data in any way that could reasonably identify Client or Client's prospect relationships.

### 4.2 Platform license

Client grants Furnace a perpetual, irrevocable, royalty-free license to store and use Client Data in transformed form solely for internal purposes, including platform operation, maintenance, improvement, and AI or machine-learning model training. This license survives termination.

### 4.3 Campaign performance data

Campaign performance data generated during the engagement, including open rates, reply rates, sequence performance, and deliverability metrics, is owned by Client. Furnace may retain anonymized, non-attributable derivatives for internal improvement.

### 4.4 Aggregate use

Furnace may use anonymized, aggregated insights from campaign data for benchmarks, product development, and published statistics, provided that use cannot reasonably identify Client, Client's prospects, or Client's campaign strategies.

### 4.5 Furnace-supplied data

If Furnace sources prospect lists or contact data as part of the engagement ("Furnace Data"), that data remains Furnace property. Client receives a limited, non-exclusive, non-transferable license to use Furnace Data for legitimate business purposes. Qualified leads or SQLs generated from Furnace Data are owned by Client, but the underlying Furnace Data is not transferred.

## 5. Intellectual property

Furnace retains exclusive ownership of all outreach systems, automation tools, platform infrastructure, algorithms, sending systems, and proprietary methodologies used to deliver the services.

Client may continue using email templates developed during the engagement after termination. Client may not replicate or use Furnace outreach systems or processes outside the platform.

## 6. Performance and reporting

Client will have access to the Furnace platform throughout the engagement, including visibility into outreach performance, response tracking, and lead activity. Furnace does not guarantee response rates, lead quality, or business outcomes. Results vary based on industry, targeting, market conditions, and other factors outside Furnace's control.

## 7. Term and termination

This agreement begins on {{effective_date_mst}} and continues month to month unless terminated. Either party may terminate with fourteen (14) days' written notice. Either party may terminate immediately for a material breach by the other party.

When this agreement ends, Furnace will stop outreach activity on Client's behalf. Client may export Client Data and leads generated during the engagement. Any license to Furnace Data ends on the termination date.

## 8. Confidentiality

Both parties will keep confidential any proprietary information exchanged during the term and for one (1) year after termination. Furnace will not share Client strategies, campaign data, or engagement-specific insights with other clients.

## 9. Indemnification

Each party will indemnify, defend, and hold harmless the other from claims, losses, liabilities, and expenses arising from that party's own actions or obligations under this agreement, except in cases of gross negligence or willful misconduct by the indemnified party. Client's indemnification obligations include claims arising from Client's direct actions inside the Furnace account.

## 10. Disclaimer of warranties

The services and platform are provided "as is" without warranties of any kind, express or implied. Furnace does not warrant that the services will be uninterrupted, error-free, or produce any specific outcome.

## 11. Limitation of liability

To the maximum extent permitted by law, Furnace is not liable for indirect, incidental, special, consequential, or punitive damages arising out of this agreement. Furnace's total liability will not exceed the fees paid by Client in the three (3) months before the claim.

## 12. Governing law

This agreement is governed by the laws of the State of Utah, without regard to conflict-of-law rules. The parties consent to exclusive jurisdiction and venue in the state and federal courts located in Utah.

## 13. Entire agreement

This agreement is the entire understanding between the parties regarding the managed-services engagement and supersedes prior agreements or understandings on that subject.
$managed_template$,
  now(),
  true
)
ON CONFLICT (version) DO UPDATE
SET
  agreement_type = EXCLUDED.agreement_type,
  title = EXCLUDED.title,
  body_markdown = EXCLUDED.body_markdown,
  is_default = EXCLUDED.is_default,
  updated_at = now();

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
  ORDER BY agreement_type ASC, is_default DESC, effective_at DESC, created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_terms_version(
  p_version TEXT,
  p_title TEXT,
  p_body_markdown TEXT,
  p_effective_at TIMESTAMPTZ DEFAULT now(),
  p_is_default BOOLEAN DEFAULT false,
  p_agreement_type TEXT DEFAULT 'platform_agreement'
)
RETURNS public.platform_terms_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_terms_versions%ROWTYPE;
  v_agreement_type TEXT := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed_services_agreement'
    ELSE 'platform_agreement'
  END;
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
    WHERE agreement_type = v_agreement_type
      AND is_default = true;
  END IF;

  INSERT INTO public.platform_terms_versions (
    version,
    agreement_type,
    title,
    body_markdown,
    effective_at,
    is_default
  )
  VALUES (
    trim(p_version),
    v_agreement_type,
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

  SELECT * INTO v_row
  FROM public.platform_terms_versions
  WHERE version = p_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terms version not found';
  END IF;

  UPDATE public.platform_terms_versions
  SET is_default = false
  WHERE agreement_type = v_row.agreement_type
    AND is_default = true;

  UPDATE public.platform_terms_versions
  SET is_default = true,
      updated_at = now()
  WHERE version = p_version
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_platform_terms_template(
  p_agreement_type TEXT,
  p_title TEXT,
  p_body_markdown TEXT
)
RETURNS public.platform_terms_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreement_type TEXT := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed_services_agreement'
    ELSE 'platform_agreement'
  END;
  v_version TEXT := CASE
    WHEN p_agreement_type = 'managed_services_agreement' THEN 'managed-services-agreement-current'
    ELSE 'platform-agreement-current'
  END;
  v_row public.platform_terms_versions%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF COALESCE(trim(p_title), '') = '' THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  IF COALESCE(trim(p_body_markdown), '') = '' THEN
    RAISE EXCEPTION 'Terms body is required';
  END IF;

  UPDATE public.platform_terms_versions
  SET is_default = false
  WHERE agreement_type = v_agreement_type
    AND version <> v_version
    AND is_default = true;

  INSERT INTO public.platform_terms_versions (
    version,
    agreement_type,
    title,
    body_markdown,
    effective_at,
    is_default
  )
  VALUES (
    v_version,
    v_agreement_type,
    trim(p_title),
    p_body_markdown,
    now(),
    true
  )
  ON CONFLICT (version) DO UPDATE
  SET
    agreement_type = EXCLUDED.agreement_type,
    title = EXCLUDED.title,
    body_markdown = EXCLUDED.body_markdown,
    effective_at = now(),
    is_default = true,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_invitation_draft(
  p_email TEXT,
  p_proposed_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
  p_first_month_discount_cents INTEGER DEFAULT 0,
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

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
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
    first_month_discount_cents,
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
    GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
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
    first_month_discount_cents,
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
    v_inv.first_month_discount_cents,
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
  p_first_month_discount_cents INTEGER DEFAULT 0,
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

  IF p_monthly_retainer_cents <= 0 THEN
    RAISE EXCEPTION 'Monthly retainer must be positive';
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
    first_month_discount_cents,
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
    GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
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
    first_month_discount_cents = GREATEST(COALESCE(p_first_month_discount_cents, 0), 0),
    proposal_snapshot_json = COALESCE(p_proposal_snapshot_json, '{}'::jsonb),
    agreement_type = v_agreement_type,
    terms_version = v_terms.version,
    terms_source_markdown = v_terms_source_markdown,
    terms_snapshot_markdown = v_terms_snapshot_markdown,
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

CREATE OR REPLACE FUNCTION public.create_platform_invitation(
  p_email TEXT,
  p_proposed_account_name TEXT,
  p_monthly_retainer_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
  p_first_month_discount_cents INTEGER DEFAULT 0,
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
    p_expires_at,
    p_agreement_type,
    p_terms_source_markdown
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

DROP FUNCTION IF EXISTS public.list_platform_invitation_revisions(UUID);

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
  agreement_type TEXT,
  terms_version TEXT,
  terms_source_markdown TEXT,
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
    pir.agreement_type,
    pir.terms_version,
    pir.terms_source_markdown,
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
    pir.agreement_type,
    pir.terms_version,
    pir.terms_source_markdown,
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
    'agreement_type', v_revision.agreement_type,
    'terms_version', v_revision.terms_version,
    'terms_source_markdown', v_revision.terms_source_markdown,
    'terms_snapshot_markdown', v_revision.terms_snapshot_markdown,
    'inviter_name', v_inv.inviter_name,
    'viewed_at', v_inv.viewed_at,
    'published_revision_number', v_inv.published_revision_number,
    'active_revision_number', v_live_revision_number,
    'selected_payment_route', v_inv.selected_payment_route,
    'selected_payment_route_fee_cents', v_inv.selected_payment_route_fee_cents,
    'selected_payment_subtotal_cents', v_inv.selected_payment_subtotal_cents,
    'selected_payment_total_cents', v_inv.selected_payment_total_cents
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_platform_terms_template(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.render_platform_terms_markdown(TEXT, TEXT, INTEGER, JSONB, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
