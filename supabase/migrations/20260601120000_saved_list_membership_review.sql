-- Review summary for saved-list membership add/remove modals + touch parent updated_at on member changes.

-- ---------------------------------------------------------------------------
-- Touch lead_saved_lists.updated_at when members change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_lead_saved_list_from_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.lead_saved_lists
  SET updated_at = now()
  WHERE id = COALESCE(NEW.list_id, OLD.list_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS touch_lead_saved_list_on_member_change ON public.lead_saved_list_members;
CREATE TRIGGER touch_lead_saved_list_on_member_change
  AFTER INSERT OR DELETE ON public.lead_saved_list_members
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_lead_saved_list_from_members();

-- ---------------------------------------------------------------------------
-- Review summary for list membership modal (selection-sized ops)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saved_list_membership_review_summary(
  p_account_id uuid,
  p_list_id uuid,
  p_global_lead_ids text[],
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unique_ids text[];
  v_requested integer;
  v_in_account integer;
  v_not_in_account integer;
  v_already_member integer;
  v_to_add integer;
  v_in_list integer;
  v_to_remove integer;
  v_not_in_list integer;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.lead_saved_lists lsl
    WHERE lsl.id = p_list_id
      AND lsl.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Saved list not found for account';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::text[])
  INTO v_unique_ids
  FROM unnest(COALESCE(p_global_lead_ids, ARRAY[]::text[])) AS id
  WHERE id IS NOT NULL AND btrim(id) <> '';

  v_requested := COALESCE(array_length(v_unique_ids, 1), 0);

  IF v_requested = 0 THEN
    IF lower(COALESCE(p_mode, '')) = 'remove' THEN
      RETURN jsonb_build_object(
        'requested', 0,
        'inList', 0,
        'toRemove', 0,
        'notInList', 0
      );
    END IF;

    RETURN jsonb_build_object(
      'requested', 0,
      'alreadyMember', 0,
      'toAdd', 0,
      'notInAccount', 0
    );
  END IF;

  IF lower(COALESCE(p_mode, '')) = 'remove' THEN
    SELECT COUNT(*)::integer
    INTO v_in_list
    FROM public.lead_saved_list_members m
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = ANY(v_unique_ids);

    v_to_remove := v_in_list;
    v_not_in_list := v_requested - v_in_list;

    RETURN jsonb_build_object(
      'requested', v_requested,
      'inList', v_in_list,
      'toRemove', v_to_remove,
      'notInList', v_not_in_list
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_in_account
  FROM public.account_lead_people alp
  WHERE alp.account_id = p_account_id
    AND alp.global_lead_id = ANY(v_unique_ids);

  v_not_in_account := v_requested - v_in_account;

  SELECT COUNT(*)::integer
  INTO v_already_member
  FROM public.lead_saved_list_members m
  WHERE m.account_id = p_account_id
    AND m.list_id = p_list_id
    AND m.global_lead_id = ANY(v_unique_ids);

  SELECT COUNT(*)::integer
  INTO v_to_add
  FROM unnest(v_unique_ids) AS gid
  WHERE EXISTS (
    SELECT 1
    FROM public.account_lead_people alp
    WHERE alp.account_id = p_account_id
      AND alp.global_lead_id = gid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.lead_saved_list_members m
    WHERE m.account_id = p_account_id
      AND m.list_id = p_list_id
      AND m.global_lead_id = gid
  );

  RETURN jsonb_build_object(
    'requested', v_requested,
    'alreadyMember', v_already_member,
    'toAdd', v_to_add,
    'notInAccount', v_not_in_account
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.saved_list_membership_review_summary(uuid, uuid, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saved_list_membership_review_summary(uuid, uuid, text[], text) TO service_role;
