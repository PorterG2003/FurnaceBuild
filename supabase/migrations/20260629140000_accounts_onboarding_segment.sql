-- Explicit, admin-owned onboarding audience override on the account.
--
-- Segment (self_serve vs done-for-you) drives onboarding copy/framing only. The
-- app derives it from the billing agreement type by default; this column lets a
-- platform admin pin it explicitly. When NULL, runtime derivation applies.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS onboarding_segment TEXT
  CHECK (onboarding_segment IS NULL OR onboarding_segment IN ('self_serve', 'dfy'));

COMMENT ON COLUMN public.accounts.onboarding_segment IS
  'Explicit onboarding audience override (self_serve | dfy). When NULL, the app derives the segment from the billing agreement type.';

-- Platform-admin writer. Mirrors the SECURITY DEFINER + is_platform_admin guard
-- used by the other admin account RPCs, so admins can set the override on any
-- account without a broad RLS UPDATE policy on the accounts table.
CREATE OR REPLACE FUNCTION public.admin_set_account_onboarding_segment(
  p_account_id UUID,
  p_segment TEXT
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

  IF p_segment IS NOT NULL AND p_segment NOT IN ('self_serve', 'dfy') THEN
    RAISE EXCEPTION 'Invalid onboarding segment: %', p_segment;
  END IF;

  UPDATE public.accounts
     SET onboarding_segment = p_segment
   WHERE id = p_account_id
  RETURNING * INTO v_account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  RETURN v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_account_onboarding_segment(UUID, TEXT) TO authenticated;
