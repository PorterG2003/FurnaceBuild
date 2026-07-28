-- ============================================================================
-- Replace Lead: attach to an existing campaign contact
-- ============================================================================
-- Before this migration `replace_lead_with_new_contact` always inserted a new
-- leads row. When the referred email was already a live lead in the same
-- campaign the result was two lead rows, two enrollments, and two parallel
-- sequences for one person.
--
-- This migration adds an attach branch: when the address already matches a live
-- lead in the campaign we reuse that lead, repoint the conversation onto it,
-- retire the old lead's sequence, and retire any duplicate rows of the same
-- address that can still send.

-- ---------------------------------------------------------------------------
-- 1) Allow 'replaced' as an enrollment stop reason
-- ---------------------------------------------------------------------------
-- Safe for reporting: enrollment_progress_state, get_campaign_lead_progress_buckets
-- and campaigns_list_summary all branch on state only, so this lands in the
-- existing `stopped` bucket. Safe for resurrection: apply_ooo_resume_core only
-- reactivates enrollments whose stopped_reason is 'replied'.
ALTER TABLE public.enrollments
  DROP CONSTRAINT IF EXISTS enrollments_stopped_reason_check;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_stopped_reason_check
  CHECK (
    stopped_reason IS NULL
    OR stopped_reason IN ('replied', 'bounced', 'unsubscribed', 'error', 'replaced')
  );

COMMENT ON COLUMN public.enrollments.stopped_reason IS
  'Why the enrollment was stopped; only meaningful when state = ''stopped''. ''replaced'' = retired by replace-lead, either the lead that was replaced away or a duplicate row of the attach target.';

-- ---------------------------------------------------------------------------
-- 2) Shared ranking: resolve one address to its primary lead in a campaign
-- ---------------------------------------------------------------------------
-- An address can already match several live rows in one campaign (legacy
-- duplicates). The pick must be deterministic and identical between the write
-- path and the form preview, so both call this one function.
--
-- Ordering is engagement-first so the row carrying the real relationship wins.
-- All four terms are needed: the boolean and the timestamp can both tie,
-- created_at ties on bulk imports, and id is the final arbiter.
CREATE OR REPLACE FUNCTION private_rank_campaign_leads_by_email(
  p_account_id uuid,
  p_campaign_id uuid,
  p_email text,
  p_exclude_lead_id uuid DEFAULT NULL
)
RETURNS TABLE (
  lead_id uuid,
  rank integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    (row_number() OVER (
      ORDER BY
        (e.state = 'active') DESC NULLS LAST,
        act.last_activity DESC NULLS LAST,
        l.created_at ASC,
        l.id ASC
    ))::integer
  FROM public.leads l
  LEFT JOIN public.enrollments e
    ON e.campaign_id = l.campaign_id
   AND e.lead_id = l.id
   AND e.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT max(t.last_message_at) AS last_activity
    FROM public.email_threads t
    WHERE t.lead_id = l.id
      AND t.campaign_id = l.campaign_id
  ) act ON true
  WHERE l.account_id = p_account_id
    AND l.campaign_id = p_campaign_id
    AND l.deleted_at IS NULL
    AND l.email IS NOT NULL
    AND btrim(l.email) <> ''
    AND lower(btrim(l.email)) = lower(btrim(p_email))
    AND (p_exclude_lead_id IS NULL OR l.id <> p_exclude_lead_id);
$$;

COMMENT ON FUNCTION private_rank_campaign_leads_by_email(uuid, uuid, text, uuid) IS
  'Deterministically ranks live leads in a campaign matching an email. rank 1 is the primary (active enrollment, then latest thread activity, then oldest, then id). Matching is lower(btrim(email)) on both sides, deliberately broader than import_api_leads_to_campaign''s exact match so mixed-case legacy rows are caught. Internal: callers must assert account membership first.';

REVOKE ALL ON FUNCTION private_rank_campaign_leads_by_email(uuid, uuid, text, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) preview_replacement_target: everything the replace form needs, one call
-- ---------------------------------------------------------------------------
-- preview_emails_in_campaigns only returns which emails match, not the status
-- the form has to explain. Bundling the block-list check in here rather than
-- doing a second query means the create path gets the suppression warning too.
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
  'Single round trip for the replace-lead form: the resolved primary existing lead (same ranking the write path uses), how many live rows the address matches, and whether it is on the block list. A NULL existingLead.enrollmentId means replace_lead_with_new_contact would refuse the attach.';

GRANT EXECUTE ON FUNCTION public.preview_replacement_target(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_replacement_target(uuid, uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) replace_lead_health_report: standing check for the success metrics
-- ---------------------------------------------------------------------------
-- Read-only. Backs scripts/audit-replace-lead-health.ts. The grouping by
-- normalized email is too expensive to do client-side over a full lead table,
-- so it lives here and the script stays a single round trip.
--
-- An attach is identified after the fact by the old lead surviving with a
-- stopped/'replaced' enrollment; the create path soft-deletes it instead.
CREATE OR REPLACE FUNCTION public.replace_lead_health_report(
  p_account_id uuid,
  p_since timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := COALESCE(p_since, '-infinity'::timestamptz);
  v_result jsonb;
BEGIN
  PERFORM private_assert_account_member(p_account_id);

  WITH live_leads AS (
    SELECT
      l.id,
      l.campaign_id,
      lower(btrim(l.email)) AS email,
      l.created_at
    FROM public.leads l
    JOIN public.campaigns c ON c.id = l.campaign_id AND c.deleted_at IS NULL
    WHERE l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.email IS NOT NULL
      AND btrim(l.email) <> ''
  ),
  dupe_pairs AS (
    SELECT
      ll.campaign_id,
      ll.email,
      count(*) AS lead_count,
      array_agg(ll.id) AS lead_ids,
      max(ll.created_at) AS newest_lead_at
    FROM live_leads ll
    GROUP BY ll.campaign_id, ll.email
    HAVING count(*) > 1
  ),
  replacement_leads AS (
    SELECT DISTINCT lr.new_lead_id AS lead_id
    FROM public.lead_replacements lr
    WHERE lr.account_id = p_account_id
      AND lr.status <> 'cancelled'
  ),
  pair_facts AS (
    SELECT
      dp.campaign_id,
      dp.email,
      dp.lead_count,
      dp.newest_lead_at,
      (
        SELECT count(*)
        FROM public.enrollments e
        WHERE e.campaign_id = dp.campaign_id
          AND e.lead_id = ANY(dp.lead_ids)
          AND e.deleted_at IS NULL
          AND e.state = 'active'
      ) AS active_count,
      (
        SELECT count(DISTINCT mj.lead_id)
        FROM public.message_jobs mj
        WHERE mj.lead_id = ANY(dp.lead_ids)
          AND mj.status = 'sent'
          AND mj.message_type = 'campaign'
      ) AS sending_lead_count,
      EXISTS (
        SELECT 1 FROM replacement_leads rl WHERE rl.lead_id = ANY(dp.lead_ids)
      ) AS from_replacement
    FROM dupe_pairs dp
  ),
  replacement_modes AS (
    SELECT
      lr.id,
      lr.campaign_id,
      lr.completed_at,
      (ol.deleted_at IS NULL AND oe.stopped_reason = 'replaced') AS is_attach
    FROM public.lead_replacements lr
    JOIN public.leads ol ON ol.id = lr.old_lead_id
    LEFT JOIN public.enrollments oe
      ON oe.campaign_id = lr.campaign_id
     AND oe.lead_id = lr.old_lead_id
     AND oe.deleted_at IS NULL
    WHERE lr.account_id = p_account_id
      AND lr.status <> 'cancelled'
      AND COALESCE(lr.completed_at, lr.created_at) >= v_since
  )
  SELECT jsonb_build_object(
    'since', CASE WHEN p_since IS NULL THEN NULL ELSE to_jsonb(p_since) END,
    'duplicatePairs', (SELECT count(*) FROM pair_facts),
    'duplicatePairsFromReplacement', (
      SELECT count(*) FROM pair_facts WHERE from_replacement
    ),
    'newDuplicatePairsFromReplacement', (
      SELECT count(*) FROM pair_facts WHERE from_replacement AND newest_lead_at >= v_since
    ),
    'doubleSendPairs', (SELECT count(*) FROM pair_facts WHERE sending_lead_count > 1),
    'doubleSendPairsFromReplacement', (
      SELECT count(*) FROM pair_facts WHERE sending_lead_count > 1 AND from_replacement
    ),
    'newDoubleSendPairsFromReplacement', (
      SELECT count(*)
      FROM pair_facts
      WHERE sending_lead_count > 1 AND from_replacement AND newest_lead_at >= v_since
    ),
    'multiActivePairs', (SELECT count(*) FROM pair_facts WHERE active_count > 1),
    'replacements', (SELECT count(*) FROM replacement_modes),
    'attachedReplacements', (SELECT count(*) FROM replacement_modes WHERE is_attach),
    'attachedCampaignIds', COALESCE(
      (SELECT jsonb_agg(DISTINCT rm.campaign_id) FROM replacement_modes rm WHERE rm.is_attach),
      '[]'::jsonb
    ),
    'threadsWithForeignEnrollment', (
      SELECT count(*)
      FROM public.email_threads t
      JOIN public.enrollments e ON e.id = t.enrollment_id
      WHERE t.account_id = p_account_id
        AND t.lead_id IS NOT NULL
        AND e.lead_id <> t.lead_id
    ),
    'campaignThreadsMissingEnrollment', (
      SELECT count(*)
      FROM public.email_threads t
      WHERE t.account_id = p_account_id
        AND t.campaign_id IS NOT NULL
        AND t.enrollment_id IS NULL
        AND t.created_at >= v_since
    ),
    'resurrectedReplacedLeads', (
      SELECT count(*)
      FROM public.enrollments e
      JOIN public.lead_replacements lr
        ON lr.old_lead_id = e.lead_id
       AND lr.campaign_id = e.campaign_id
       AND lr.status <> 'cancelled'
      WHERE lr.account_id = p_account_id
        AND e.deleted_at IS NULL
        AND e.state = 'active'
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.replace_lead_health_report(uuid, timestamptz) IS
  'Read-only health metrics for the replace-lead attach behaviour: in-campaign duplicate pairs, double-sends, multi-active duplicates, attach rate, thread enrollment integrity, and retired-lead resurrection. Backs scripts/audit-replace-lead-health.ts.';

GRANT EXECUTE ON FUNCTION public.replace_lead_health_report(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_lead_health_report(uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) replace_lead_with_new_contact: create branch (unchanged) + attach branch
-- ---------------------------------------------------------------------------
-- Return signature gains mode/target_lead_id/retired_sibling_count, so the old
-- function has to be dropped first.
DROP FUNCTION IF EXISTS public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
);

CREATE OR REPLACE FUNCTION public.replace_lead_with_new_contact(
  p_old_lead_id uuid,
  p_new_email text,
  p_new_name text DEFAULT NULL,
  p_new_first_name text DEFAULT NULL,
  p_new_last_name text DEFAULT NULL,
  p_new_phone_number text DEFAULT NULL,
  p_new_mobile_phone_number text DEFAULT NULL,
  p_reason public.replacement_reason_enum DEFAULT 'manual_referral',
  p_reason_note text DEFAULT NULL,
  p_source_message_id uuid DEFAULT NULL
)
RETURNS TABLE (
  replacement_id uuid,
  new_lead_id uuid,
  enrollment_id uuid,
  mode text,
  target_lead_id uuid,
  retired_sibling_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_lead public.leads%ROWTYPE;
  v_target public.leads%ROWTYPE;
  v_new_lead_id uuid;
  v_replacement_id uuid;
  v_moved_enrollment_id uuid;
  v_target_enrollment_id uuid;
  v_match_ids uuid[];
  v_sibling_ids uuid[];
  v_retired_siblings integer := 0;
  v_mode text;
  v_now timestamptz := now();
  v_new_email text := NULLIF(lower(trim(p_new_email)), '');
  v_new_name text := NULLIF(trim(p_new_name), '');
  v_new_first_name text := NULLIF(trim(p_new_first_name), '');
  v_new_last_name text := NULLIF(trim(p_new_last_name), '');
  v_new_phone text := NULLIF(trim(p_new_phone_number), '');
  v_new_mobile_phone text := NULLIF(trim(p_new_mobile_phone_number), '');
BEGIN
  IF p_old_lead_id IS NULL THEN
    RAISE EXCEPTION 'old_lead_id is required';
  END IF;

  IF v_new_email IS NULL THEN
    RAISE EXCEPTION 'new_email is required';
  END IF;

  SELECT *
  INTO v_old_lead
  FROM public.leads
  WHERE id = p_old_lead_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found or already removed';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.account_id = v_old_lead.account_id
        AND au.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lead_replacements lr
    WHERE lr.old_lead_id = v_old_lead.id
      AND lr.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Lead already has a replacement';
  END IF;

  IF v_old_lead.email IS NOT NULL AND lower(trim(v_old_lead.email)) = v_new_email THEN
    RAISE EXCEPTION 'Replacement email must differ from the original lead email';
  END IF;

  IF p_source_message_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.email_messages em
      JOIN public.email_threads et ON et.id = em.thread_id
      WHERE em.id = p_source_message_id
        AND et.account_id = v_old_lead.account_id
    ) THEN
      RAISE EXCEPTION 'source_message_id does not belong to this account';
    END IF;
  END IF;

  -- Serialize concurrent replaces to the same address in the same campaign. An
  -- advisory lock rather than FOR UPDATE because the rows we need to protect are
  -- the ones we are about to discover, not ones we already hold.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_old_lead.campaign_id::text || '|' || v_new_email, 0)
  );

  SELECT array_agg(r.lead_id ORDER BY r.rank)
  INTO v_match_ids
  FROM private_rank_campaign_leads_by_email(
    v_old_lead.account_id,
    v_old_lead.campaign_id,
    v_new_email,
    v_old_lead.id
  ) r;

  IF COALESCE(array_length(v_match_ids, 1), 0) = 0 THEN
    -- ---------------------------------------------------------------------
    -- Create path: unchanged behaviour from before this migration.
    -- ---------------------------------------------------------------------
    v_mode := 'created';

    INSERT INTO public.leads (
      campaign_id,
      bucket_id,
      account_id,
      email,
      name,
      first_name,
      last_name,
      company_name,
      website,
      linkedin_url,
      company_linkedin_url,
      phone_number,
      mobile_phone_number,
      source,
      custom_lead_data,
      global_lead_id,
      smartlead_lead_id,
      mailbox_id,
      deleted_at,
      created_at,
      updated_at
    ) VALUES (
      v_old_lead.campaign_id,
      v_old_lead.bucket_id,
      v_old_lead.account_id,
      v_new_email,
      v_new_name,
      v_new_first_name,
      v_new_last_name,
      v_old_lead.company_name,
      v_old_lead.website,
      v_old_lead.linkedin_url,
      v_old_lead.company_linkedin_url,
      COALESCE(v_new_phone, v_old_lead.phone_number),
      COALESCE(v_new_mobile_phone, v_old_lead.mobile_phone_number),
      v_old_lead.source,
      v_old_lead.custom_lead_data,
      public.generate_global_lead_id(v_new_email),
      NULL,
      v_old_lead.mailbox_id,
      NULL,
      v_now,
      v_now
    )
    RETURNING id INTO v_new_lead_id;

    UPDATE public.enrollments
    SET
      lead_id = v_new_lead_id,
      updated_at = v_now
    WHERE campaign_id = v_old_lead.campaign_id
      AND lead_id = v_old_lead.id
      AND deleted_at IS NULL
    RETURNING id INTO v_moved_enrollment_id;

    UPDATE public.message_jobs
    SET
      lead_id = v_new_lead_id,
      updated_at = v_now
    WHERE lead_id = v_old_lead.id
      AND status IN ('queued', 'reserved');

    UPDATE public.email_threads
    SET
      lead_id = v_new_lead_id,
      participants = CASE
        WHEN v_new_email IS NULL THEN participants
        WHEN participants @> ARRAY[v_new_email]::text[] THEN participants
        ELSE array_append(COALESCE(participants, ARRAY[]::text[]), v_new_email)
      END,
      updated_at = v_now
    WHERE lead_id = v_old_lead.id;

    UPDATE public.leads
    SET
      deleted_at = v_now,
      updated_at = v_now
    WHERE id = v_old_lead.id;
  ELSE
    -- ---------------------------------------------------------------------
    -- Attach path: reuse the primary existing lead.
    -- ---------------------------------------------------------------------
    v_mode := 'attached';

    SELECT * INTO v_target FROM public.leads WHERE id = v_match_ids[1] FOR UPDATE;
    v_new_lead_id := v_target.id;
    v_sibling_ids := v_match_ids[2:];

    IF EXISTS (
      SELECT 1
      FROM public.lead_replacements lr
      WHERE lr.old_lead_id = v_target.id
        AND lr.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'Existing contact % has already been replaced by someone else', v_target.email;
    END IF;

    -- The forward job copies enrollment_id off the thread, and
    -- message_jobs.enrollment_id is NOT NULL, so a thread repointed to an
    -- enrollment-less lead would blow up the moment the user hits Forward.
    SELECT e.id
    INTO v_target_enrollment_id
    FROM public.enrollments e
    WHERE e.campaign_id = v_old_lead.campaign_id
      AND e.lead_id = v_target.id
      AND e.deleted_at IS NULL;

    IF v_target_enrollment_id IS NULL THEN
      RAISE EXCEPTION 'Existing contact % has no active enrollment in this campaign; launch the campaign or re-add the contact before replacing', v_target.email;
    END IF;

    -- Fill blanks only. Never overwrite a real contact's populated data.
    UPDATE public.leads l
    SET
      name = CASE WHEN l.name IS NULL OR btrim(l.name) = '' THEN v_new_name ELSE l.name END,
      first_name = CASE WHEN l.first_name IS NULL OR btrim(l.first_name) = '' THEN v_new_first_name ELSE l.first_name END,
      last_name = CASE WHEN l.last_name IS NULL OR btrim(l.last_name) = '' THEN v_new_last_name ELSE l.last_name END,
      phone_number = CASE WHEN l.phone_number IS NULL OR btrim(l.phone_number) = '' THEN v_new_phone ELSE l.phone_number END,
      mobile_phone_number = CASE WHEN l.mobile_phone_number IS NULL OR btrim(l.mobile_phone_number) = '' THEN v_new_mobile_phone ELSE l.mobile_phone_number END,
      company_name = CASE WHEN l.company_name IS NULL OR btrim(l.company_name) = '' THEN v_old_lead.company_name ELSE l.company_name END,
      website = CASE WHEN l.website IS NULL OR btrim(l.website) = '' THEN v_old_lead.website ELSE l.website END,
      company_linkedin_url = CASE WHEN l.company_linkedin_url IS NULL OR btrim(l.company_linkedin_url) = '' THEN v_old_lead.company_linkedin_url ELSE l.company_linkedin_url END,
      custom_lead_data = CASE
        WHEN v_old_lead.custom_lead_data IS NULL THEN l.custom_lead_data
        ELSE v_old_lead.custom_lead_data || COALESCE(l.custom_lead_data, '{}'::jsonb)
      END,
      updated_at = v_now
    WHERE l.id = v_target.id;

    SELECT * INTO v_target FROM public.leads WHERE id = v_target.id;

    -- Repoint the conversation, including enrollment_id. Without the
    -- enrollment_id repoint the forward would carry the retired enrollment and
    -- a reply would flip it back to 'replied', which OOO can resurrect.
    UPDATE public.email_threads
    SET
      lead_id = v_target.id,
      enrollment_id = v_target_enrollment_id,
      participants = CASE
        WHEN participants @> ARRAY[v_new_email]::text[] THEN participants
        ELSE array_append(COALESCE(participants, ARRAY[]::text[]), v_new_email)
      END,
      updated_at = v_now
    WHERE lead_id = v_old_lead.id;

    -- Retire the old lead. Its enrollment stays on it and the lead row stays
    -- live, which is what keeps campaigns_list_summary and
    -- get_campaign_lead_progress_buckets agreeing with each other.
    UPDATE public.enrollments
    SET
      state = 'stopped',
      stopped_reason = 'replaced',
      stopped_at = v_now,
      next_run_at = NULL,
      updated_at = v_now
    WHERE campaign_id = v_old_lead.campaign_id
      AND lead_id = v_old_lead.id
      AND deleted_at IS NULL
    RETURNING id INTO v_moved_enrollment_id;

    UPDATE public.message_jobs
    SET
      status = 'cancelled',
      updated_at = v_now
    WHERE lead_id = v_old_lead.id
      AND status IN ('queued', 'reserved');

    -- Retire duplicate rows of the same address, but only the ones that can
    -- still send. Terminal enrollments are left exactly as they are: they
    -- cannot send, and rewriting them would move finished leads out of the
    -- Completed dial for no benefit.
    IF COALESCE(array_length(v_sibling_ids, 1), 0) > 0 THEN
      WITH retired AS (
        UPDATE public.enrollments e
        SET
          state = 'stopped',
          stopped_reason = 'replaced',
          stopped_at = v_now,
          next_run_at = NULL,
          updated_at = v_now
        WHERE e.campaign_id = v_old_lead.campaign_id
          AND e.lead_id = ANY(v_sibling_ids)
          AND e.deleted_at IS NULL
          AND e.state IN ('active', 'paused')
        RETURNING e.id
      )
      SELECT count(*)::integer INTO v_retired_siblings FROM retired;

      UPDATE public.message_jobs
      SET
        status = 'cancelled',
        updated_at = v_now
      WHERE lead_id = ANY(v_sibling_ids)
        AND status IN ('queued', 'reserved');
    END IF;
  END IF;

  INSERT INTO public.lead_replacements (
    account_id,
    campaign_id,
    old_lead_id,
    new_lead_id,
    status,
    reason,
    reason_note,
    source_message_id,
    created_by,
    created_at,
    completed_at
  ) VALUES (
    v_old_lead.account_id,
    v_old_lead.campaign_id,
    v_old_lead.id,
    v_new_lead_id,
    'completed',
    p_reason,
    NULLIF(trim(p_reason_note), ''),
    p_source_message_id,
    auth.uid(),
    v_now,
    v_now
  )
  RETURNING id INTO v_replacement_id;

  RETURN QUERY
  SELECT
    v_replacement_id,
    v_new_lead_id,
    CASE WHEN v_mode = 'attached' THEN v_target_enrollment_id ELSE v_moved_enrollment_id END,
    v_mode,
    v_new_lead_id,
    v_retired_siblings;
END;
$$;

COMMENT ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) IS
  'Replaces a lead with a referred contact. When the address is not already in the campaign it creates a lead, moves the enrollment, reassigns queued/reserved jobs and thread ownership, and archives the original lead (mode = created). When the address already matches a live lead it attaches instead (mode = attached): the primary existing lead is reused, the thread is repointed to it including enrollment_id, the old lead is retired as stopped/replaced with its lead row kept live, and duplicate rows of the same address that can still send are retired too. The attach target''s own enrollment is never touched.';

GRANT EXECUTE ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.replace_lead_with_new_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  public.replacement_reason_enum,
  text,
  uuid
) TO service_role;
