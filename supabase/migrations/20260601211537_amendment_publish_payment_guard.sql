-- Only block amendment publish on payment_required when the draft increases retainer
-- (matches apply_account_billing_adjustment). Terms-only / same / lower retainer may publish.
--
-- Older environments may not have the amendment tables yet when this migration runs.
-- In that case, skip the function rewrite here; the later base amendment migration
-- creates the function once the tables exist.
DO $$
BEGIN
  IF to_regclass('public.platform_account_amendments') IS NULL
     OR to_regclass('public.platform_account_amendment_revisions') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.publish_platform_account_amendment(p_amendment_id UUID)
    RETURNS public.platform_account_amendments
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      v_amendment public.platform_account_amendments%ROWTYPE;
      v_billing public.account_billing%ROWTYPE;
      v_revision public.platform_account_amendment_revisions%ROWTYPE;
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

      SELECT * INTO v_revision
      FROM public.platform_account_amendment_revisions
      WHERE amendment_id = v_amendment.id
        AND revision_number = v_amendment.current_revision_number;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Amendment revision not found';
      END IF;

      SELECT * INTO v_billing FROM public.account_billing WHERE account_id = v_amendment.account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Account billing not found';
      END IF;

      IF v_billing.billing_status = 'payment_required'
         AND v_revision.monthly_retainer_cents > v_billing.monthly_retainer_cents THEN
        RAISE EXCEPTION 'Resolve payment issues before publishing a retainer increase';
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
    $body$;
  $fn$;
END;
$$;
