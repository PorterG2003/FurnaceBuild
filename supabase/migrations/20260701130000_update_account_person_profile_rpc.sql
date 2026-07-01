-- Server-side profile apply for account-scoped person edits (enrich apply + profile form).
-- Replaces fragile client PATCH on leads/account_lead_people; refreshes rollup after write.

CREATE OR REPLACE FUNCTION public.update_account_person_profile(
  p_account_id uuid,
  p_global_lead_id text,
  p_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
  v_lead_id uuid;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF p_global_lead_id IS NULL OR btrim(p_global_lead_id) = '' THEN
    RAISE EXCEPTION 'p_global_lead_id is required';
  END IF;

  IF p_updates IS NULL OR p_updates = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE public.leads l
  SET
    name = CASE WHEN p_updates ? 'name' THEN NULLIF(btrim(p_updates->>'name'), '') ELSE l.name END,
    first_name = CASE WHEN p_updates ? 'first_name' THEN NULLIF(btrim(p_updates->>'first_name'), '') ELSE l.first_name END,
    last_name = CASE WHEN p_updates ? 'last_name' THEN NULLIF(btrim(p_updates->>'last_name'), '') ELSE l.last_name END,
    company_name = CASE WHEN p_updates ? 'company_name' THEN NULLIF(btrim(p_updates->>'company_name'), '') ELSE l.company_name END,
    website = CASE WHEN p_updates ? 'website' THEN NULLIF(btrim(p_updates->>'website'), '') ELSE l.website END,
    linkedin_url = CASE WHEN p_updates ? 'linkedin_url' THEN NULLIF(btrim(p_updates->>'linkedin_url'), '') ELSE l.linkedin_url END,
    company_linkedin_url = CASE WHEN p_updates ? 'company_linkedin_url' THEN NULLIF(btrim(p_updates->>'company_linkedin_url'), '') ELSE l.company_linkedin_url END,
    phone_number = CASE WHEN p_updates ? 'phone_number' THEN NULLIF(btrim(p_updates->>'phone_number'), '') ELSE l.phone_number END,
    custom_lead_data = CASE
      WHEN p_updates ? 'custom_lead_data' THEN p_updates->'custom_lead_data'
      ELSE l.custom_lead_data
    END,
    updated_at = now()
  WHERE l.account_id = p_account_id
    AND l.global_lead_id = p_global_lead_id
    AND l.deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT l.id
    INTO v_lead_id
    FROM public.leads l
    WHERE l.account_id = p_account_id
      AND l.global_lead_id = p_global_lead_id
    ORDER BY l.created_at DESC
    LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
      UPDATE public.leads l
      SET
        name = CASE WHEN p_updates ? 'name' THEN NULLIF(btrim(p_updates->>'name'), '') ELSE l.name END,
        first_name = CASE WHEN p_updates ? 'first_name' THEN NULLIF(btrim(p_updates->>'first_name'), '') ELSE l.first_name END,
        last_name = CASE WHEN p_updates ? 'last_name' THEN NULLIF(btrim(p_updates->>'last_name'), '') ELSE l.last_name END,
        company_name = CASE WHEN p_updates ? 'company_name' THEN NULLIF(btrim(p_updates->>'company_name'), '') ELSE l.company_name END,
        website = CASE WHEN p_updates ? 'website' THEN NULLIF(btrim(p_updates->>'website'), '') ELSE l.website END,
        linkedin_url = CASE WHEN p_updates ? 'linkedin_url' THEN NULLIF(btrim(p_updates->>'linkedin_url'), '') ELSE l.linkedin_url END,
        company_linkedin_url = CASE WHEN p_updates ? 'company_linkedin_url' THEN NULLIF(btrim(p_updates->>'company_linkedin_url'), '') ELSE l.company_linkedin_url END,
        phone_number = CASE WHEN p_updates ? 'phone_number' THEN NULLIF(btrim(p_updates->>'phone_number'), '') ELSE l.phone_number END,
        custom_lead_data = CASE
          WHEN p_updates ? 'custom_lead_data' THEN p_updates->'custom_lead_data'
          ELSE l.custom_lead_data
        END,
        updated_at = now()
      WHERE l.id = v_lead_id;
    END IF;
  END IF;

  PERFORM private_refresh_account_lead_person(p_account_id, p_global_lead_id);
END;
$$;

COMMENT ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) IS
  'Apply profile-field updates to all active lead rows for a person (or the newest row when none are active), then refresh account_lead_people.';

REVOKE ALL ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_account_person_profile(uuid, text, jsonb) TO service_role;

-- Keep explorer rollup in sync when enrich applies phone, LinkedIn, website, or custom fields.
DROP TRIGGER IF EXISTS refresh_account_lead_person_on_leads ON public.leads;
CREATE TRIGGER refresh_account_lead_person_on_leads
  AFTER INSERT OR UPDATE OF
    email,
    name,
    first_name,
    last_name,
    company_name,
    website,
    linkedin_url,
    company_linkedin_url,
    phone_number,
    custom_lead_data,
    deleted_at,
    global_lead_id,
    account_id
  OR DELETE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION private_trigger_refresh_account_lead_person();
