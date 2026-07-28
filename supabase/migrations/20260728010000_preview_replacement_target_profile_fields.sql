-- Extend preview_replacement_target so the replace-lead form can prefill and
-- lock profile fields when attaching to an existing campaign contact.

CREATE OR REPLACE FUNCTION public.preview_replacement_target(
  p_account_id uuid,
  p_campaign_id uuid,
  p_email text,
  p_old_lead_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_domain text;
  v_primary_id uuid;
  v_lead public.leads%ROWTYPE;
  v_duplicate_count integer := 0;
  v_enrollment_id uuid;
  v_enrollment_state text;
  v_has_been_contacted boolean := false;
  v_last_activity timestamptz;
  v_blocked boolean := false;
  v_block_reason text;
  v_matches_old_lead boolean := false;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  IF v_email IS NULL THEN
    RETURN jsonb_build_object(
      'email', NULL,
      'duplicateCount', 0,
      'existingLead', NULL,
      'blocked', false,
      'blockReason', NULL,
      'matchesOldLead', false
    );
  END IF;

  v_domain := NULLIF(split_part(v_email, '@', 2), '');

  IF p_old_lead_id IS NOT NULL THEN
    SELECT lower(btrim(l.email)) = v_email
    INTO v_matches_old_lead
    FROM public.leads l
    WHERE l.id = p_old_lead_id;
    v_matches_old_lead := COALESCE(v_matches_old_lead, false);
  END IF;

  SELECT count(*)::integer
  INTO v_duplicate_count
  FROM private_rank_campaign_leads_by_email(p_account_id, p_campaign_id, v_email, p_old_lead_id);

  SELECT r.lead_id
  INTO v_primary_id
  FROM private_rank_campaign_leads_by_email(p_account_id, p_campaign_id, v_email, p_old_lead_id) r
  WHERE r.rank = 1;

  -- Match isEmailBlocked in the send worker: exact address or whole domain.
  SELECT true, bl.reason
  INTO v_blocked, v_block_reason
  FROM public.block_list bl
  WHERE bl.account_id = p_account_id
    AND (
      (bl.type = 'email' AND lower(btrim(bl.value)) = v_email)
      OR (bl.type = 'domain' AND v_domain IS NOT NULL AND lower(btrim(bl.value)) = v_domain)
    )
  ORDER BY (bl.type = 'email') DESC
  LIMIT 1;

  v_blocked := COALESCE(v_blocked, false);

  IF v_primary_id IS NULL THEN
    RETURN jsonb_build_object(
      'email', v_email,
      'duplicateCount', 0,
      'existingLead', NULL,
      'blocked', v_blocked,
      'blockReason', v_block_reason,
      'matchesOldLead', v_matches_old_lead
    );
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = v_primary_id;

  SELECT e.id, e.state
  INTO v_enrollment_id, v_enrollment_state
  FROM public.enrollments e
  WHERE e.campaign_id = p_campaign_id
    AND e.lead_id = v_primary_id
    AND e.deleted_at IS NULL;

  SELECT EXISTS (
    SELECT 1
    FROM public.message_jobs mj
    WHERE mj.lead_id = v_primary_id
      AND mj.status = 'sent'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
  )
  INTO v_has_been_contacted;

  SELECT max(t.last_message_at)
  INTO v_last_activity
  FROM public.email_threads t
  WHERE t.lead_id = v_primary_id
    AND t.campaign_id = p_campaign_id;

  RETURN jsonb_build_object(
    'email', v_email,
    'duplicateCount', v_duplicate_count,
    'existingLead', jsonb_build_object(
      'id', v_lead.id,
      'email', v_lead.email,
      'name', v_lead.name,
      'firstName', v_lead.first_name,
      'lastName', v_lead.last_name,
      'phoneNumber', v_lead.phone_number,
      'mobilePhoneNumber', v_lead.mobile_phone_number,
      'companyName', v_lead.company_name,
      'website', v_lead.website,
      'linkedinUrl', v_lead.linkedin_url,
      'companyLinkedinUrl', v_lead.company_linkedin_url,
      'customLeadData', COALESCE(v_lead.custom_lead_data, '{}'::jsonb),
      'enrollmentId', v_enrollment_id,
      'enrollmentState', v_enrollment_state,
      'hasBeenContacted', v_has_been_contacted,
      'lastActivityAt', v_last_activity
    ),
    'blocked', v_blocked,
    'blockReason', v_block_reason,
    'matchesOldLead', v_matches_old_lead
  );
END;
$$;

COMMENT ON FUNCTION public.preview_replacement_target(uuid, uuid, text, uuid) IS
  'Single round trip for the replace-lead form: the resolved primary existing lead (same ranking the write path uses), profile fields for attach-mode prefills, how many live rows the address matches, and whether it is on the block list. A NULL existingLead.enrollmentId means replace_lead_with_new_contact would refuse the attach.';
