-- ============================================
-- Migration: Categorizer node — hold/restore, parked enrollments, campaign_reply jobs
-- Spec: docs/implementation/flow/CATEGORIZER_IMPLEMENTATION.md
-- ============================================
-- A reply to a campaign with a categorizer node HOLDS the remaining outbound
-- sequence (jobs -> 'held', position snapshotted) and fast-forwards the
-- enrollment to the categorizer. A real category branches and cancels the
-- holds; an Auto Reply restores the sequence (optionally timed to an
-- extracted return date). Parked enrollments use next_run_at = NULL so the
-- scheduler claim loop never sees them; wakes are event-driven plus a
-- 30-minute safety sweep.

-- ============================================
-- 1. Enrollment columns + parked index
-- ============================================

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS reply_thread_id UUID,
  ADD COLUMN IF NOT EXISTS held_node_id UUID,
  ADD COLUMN IF NOT EXISTS held_next_run_at TIMESTAMPTZ;

COMMENT ON COLUMN enrollments.reply_thread_id IS
  'Thread the categorizer branched on. Set once at branch time; acts as the "already categorized" idempotency marker and the thread downstream reply-mode emails use.';
COMMENT ON COLUMN enrollments.held_node_id IS
  'Outbound position snapshot taken when a reply held the sequence. Non-NULL = sequence on hold and restorable. Cleared on restore or branch.';
COMMENT ON COLUMN enrollments.held_next_run_at IS
  'next_run_at snapshot paired with held_node_id, used to restore wait-node timing.';

-- Parked enrollments (waiting at a categorizer): state='active', next_run_at IS NULL.
CREATE INDEX IF NOT EXISTS enrollments_parked_categorizer_idx
  ON enrollments (campaign_id, current_node_id)
  WHERE state = 'active' AND next_run_at IS NULL AND deleted_at IS NULL;

-- Latest replied thread per enrollment (categorizer handler + sweep).
CREATE INDEX IF NOT EXISTS email_threads_enrollment_replied_idx
  ON email_threads (enrollment_id, last_message_at DESC)
  WHERE has_reply IS TRUE AND enrollment_id IS NOT NULL;

-- ============================================
-- 2. message_jobs: 'held' status + 'campaign_reply' message_type
-- ============================================

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_status_check;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_status_check
  CHECK (status IN ('queued', 'reserved', 'sending', 'sent', 'deferred', 'failed', 'cancelled', 'blocked', 'held'));

ALTER TABLE message_jobs
  DROP CONSTRAINT IF EXISTS message_jobs_message_type_check;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_message_type_check
  CHECK (message_type IN ('campaign', 'inbox_reply', 'inbox_forward', 'campaign_reply'));

COMMENT ON COLUMN message_jobs.message_type IS
  'campaign = scheduler-created; inbox_reply | inbox_forward = user-initiated from inbox (interval_id NULL, node_id NULL); campaign_reply = flow reply-mode email sent in-thread (node_id set, interval_id NULL, priority lane).';

-- Strict status/status_reason validator: add 'held' (reason NULL like other live
-- states) and the 'reply_received' cancelled reason used when a branch cancels holds.
CREATE OR REPLACE FUNCTION public.message_job_status_reason_is_valid(
  p_status TEXT,
  p_status_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_status
    WHEN 'queued' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'reserved' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sending' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'held' THEN
      RETURN p_status_reason IS NULL;
    WHEN 'sent' THEN
      RETURN p_status_reason = 'sent_successfully';
    WHEN 'deferred' THEN
      RETURN p_status_reason IN (
        'daily_throttle_limit',
        'hourly_throttle_limit',
        'min_gap_not_met',
        'campaign_paused',
        'enrollment_paused',
        'transient_read_error'
      );
    WHEN 'failed' THEN
      RETURN p_status_reason IN (
        'provider_error',
        'template_render_error',
        'uncertain_send_state'
      );
    WHEN 'cancelled' THEN
      RETURN p_status_reason IN (
        'campaign_deleted',
        'mailbox_deleted',
        'lead_deleted',
        'enrollment_deleted',
        'node_deleted',
        'enrollment_not_active',
        'manually_cancelled',
        'reply_received'
      );
    WHEN 'blocked' THEN
      RETURN p_status_reason IN (
        'lead_blocked',
        'mailbox_blocked'
      );
    ELSE
      RETURN FALSE;
  END CASE;
END;
$$;

-- Held jobs per enrollment (hold/restore/cancel paths).
CREATE INDEX IF NOT EXISTS idx_message_jobs_held_enrollment
  ON message_jobs (enrollment_id)
  WHERE status = 'held';

-- Manual-priority claim lane now includes campaign_reply.
DROP INDEX IF EXISTS idx_message_jobs_pending_manual;
CREATE INDEX IF NOT EXISTS idx_message_jobs_queued_manual
  ON message_jobs (scheduled_at)
  WHERE status = 'queued' AND message_type IN ('inbox_reply', 'inbox_forward', 'campaign_reply');

-- ============================================
-- 3. claim_manual_message_jobs_ready: include campaign_reply
--    (latest body from 20260507202153, message_type set extended)
-- ============================================

CREATE OR REPLACE FUNCTION claim_manual_message_jobs_ready(
  p_batch_size INTEGER DEFAULT 50,
  p_processing_timeout_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  enrollment_id UUID,
  campaign_id UUID,
  lead_id UUID,
  mailbox_id UUID,
  node_id UUID,
  message_type TEXT,
  status TEXT,
  scheduled_at TIMESTAMPTZ,
  reserved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  error_message TEXT,
  retry_count INTEGER,
  max_retries INTEGER,
  message_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT mj.id, mj.scheduled_at
    FROM message_jobs mj
    INNER JOIN mailboxes m
      ON m.id = mj.mailbox_id
     AND m.deleted_at IS NULL
    WHERE mj.status = 'queued'
      AND mj.scheduled_at <= NOW()
      AND mj.message_type IN ('inbox_reply', 'inbox_forward', 'campaign_reply')
    ORDER BY mj.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF mj SKIP LOCKED
  ),
  updated_jobs AS (
    UPDATE message_jobs mj
    SET
      status = 'reserved',
      status_reason = NULL,
      reserved_at = NOW(),
      updated_at = NOW()
    FROM candidate_jobs cj
    WHERE mj.id = cj.id
    RETURNING
      mj.id,
      mj.enrollment_id,
      mj.campaign_id,
      mj.lead_id,
      mj.mailbox_id,
      mj.node_id,
      mj.message_type,
      mj.status,
      mj.scheduled_at,
      mj.reserved_at,
      mj.sent_at,
      mj.provider_message_id,
      mj.error_message,
      mj.retry_count,
      mj.max_retries,
      mj.message_data,
      mj.created_at,
      mj.updated_at
  )
  SELECT
    updated_jobs.id,
    updated_jobs.enrollment_id,
    updated_jobs.campaign_id,
    updated_jobs.lead_id,
    updated_jobs.mailbox_id,
    updated_jobs.node_id,
    updated_jobs.message_type,
    updated_jobs.status,
    updated_jobs.scheduled_at,
    updated_jobs.reserved_at,
    updated_jobs.sent_at,
    updated_jobs.provider_message_id,
    updated_jobs.error_message,
    updated_jobs.retry_count,
    updated_jobs.max_retries,
    updated_jobs.message_data,
    updated_jobs.created_at,
    updated_jobs.updated_at
  FROM updated_jobs
  ORDER BY updated_jobs.scheduled_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_manual_message_jobs_ready IS
  'Claims priority-lane jobs (inbox_reply, inbox_forward, campaign_reply) ready to send. Call before claim_message_jobs_ready.';

-- ============================================
-- 4. park_or_advance_enrollment_on_reply
-- ============================================
-- Called by the inbox-checker when a reply-to-original lands on a campaign
-- whose flow contains a categorizer. Holds the outbound sequence, snapshots
-- position, fast-forwards to the categorizer, and wakes the enrollment.
-- Always wakes an already-parked enrollment without re-snapshotting.

-- Returns a status so the caller can decide whether to fall back to the
-- legacy hard stop:
--   'held'     - sequence held + fast-forwarded to the categorizer
--   'woken'    - already at the categorizer; woken without re-snapshotting
--   'branched' - enrollment already categorized (do NOT stop it)
--   'ineligible' - not active / no categorizer in flow (caller applies legacy stop)
CREATE OR REPLACE FUNCTION public.park_or_advance_enrollment_on_reply(
  p_enrollment_id UUID,
  p_thread_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment RECORD;
  v_categorizer_node_id UUID;
BEGIN
  IF p_enrollment_id IS NULL THEN
    RETURN 'ineligible';
  END IF;

  SELECT e.id, e.campaign_id, e.current_node_id, e.next_run_at, e.reply_thread_id, e.held_node_id
  INTO v_enrollment
  FROM enrollments e
  WHERE e.id = p_enrollment_id
    AND e.state = 'active'
    AND e.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'ineligible';
  END IF;

  -- Already branched: replies after categorization never re-route, and the
  -- enrollment is actively walking a branch - it must NOT be stopped.
  IF v_enrollment.reply_thread_id IS NOT NULL THEN
    RETURN 'branched';
  END IF;

  SELECT n.id
  INTO v_categorizer_node_id
  FROM nodes n
  WHERE n.campaign_id = v_enrollment.campaign_id
    AND n.node_type = 'aiCategorizer'
    AND n.deleted_at IS NULL
  ORDER BY n.created_at ASC
  LIMIT 1;

  IF v_categorizer_node_id IS NULL THEN
    RETURN 'ineligible';
  END IF;

  IF v_enrollment.current_node_id IS DISTINCT FROM v_categorizer_node_id THEN
    -- Hold the remaining outbound sequence (campaign jobs only; manual inbox
    -- jobs are never touched).
    UPDATE message_jobs mj
    SET
      status = 'held',
      status_reason = NULL,
      updated_at = NOW()
    WHERE mj.enrollment_id = p_enrollment_id
      AND mj.status = 'queued'
      AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
      AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward');

    UPDATE enrollments e
    SET
      -- Keep the first snapshot if a previous hold exists (second reply
      -- before classification must not overwrite the original position).
      held_node_id = COALESCE(e.held_node_id, e.current_node_id),
      held_next_run_at = CASE WHEN e.held_node_id IS NULL THEN e.next_run_at ELSE e.held_next_run_at END,
      current_node_id = v_categorizer_node_id,
      next_run_at = NOW(),
      updated_at = NOW()
    WHERE e.id = p_enrollment_id;

    RETURN 'held';
  ELSE
    -- Already at the categorizer (possibly parked): just wake it.
    UPDATE enrollments e
    SET
      next_run_at = NOW(),
      updated_at = NOW()
    WHERE e.id = p_enrollment_id;

    RETURN 'woken';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.park_or_advance_enrollment_on_reply(UUID, UUID) IS
  'Reply handling for categorizer flows: hold queued campaign jobs, snapshot position, fast-forward to the categorizer, wake (next_run_at = NOW()). Returns held|woken|branched|ineligible.';

REVOKE ALL ON FUNCTION public.park_or_advance_enrollment_on_reply(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.park_or_advance_enrollment_on_reply(UUID, UUID) TO service_role;

-- ============================================
-- 5. restore_enrollment_outbound
-- ============================================
-- Called by the scheduler when the categorizer resolves Auto Reply: release
-- held jobs and put the enrollment back where it was, no earlier than
-- p_resume_at (extracted OOO return date) and never in the past.

CREATE OR REPLACE FUNCTION public.restore_enrollment_outbound(
  p_enrollment_id UUID,
  p_resume_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment RECORD;
  v_floor TIMESTAMPTZ := GREATEST(COALESCE(p_resume_at, NOW()), NOW());
BEGIN
  IF p_enrollment_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT e.id, e.held_node_id, e.held_next_run_at
  INTO v_enrollment
  FROM enrollments e
  WHERE e.id = p_enrollment_id
    AND e.state = 'active'
    AND e.deleted_at IS NULL
    AND e.held_node_id IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Release held jobs; never reschedule earlier than the resume floor.
  UPDATE message_jobs mj
  SET
    status = 'queued',
    status_reason = NULL,
    scheduled_at = GREATEST(mj.scheduled_at, v_floor),
    updated_at = NOW()
  WHERE mj.enrollment_id = p_enrollment_id
    AND mj.status = 'held';

  UPDATE enrollments e
  SET
    current_node_id = v_enrollment.held_node_id,
    next_run_at = GREATEST(COALESCE(v_enrollment.held_next_run_at, NOW()), v_floor),
    held_node_id = NULL,
    held_next_run_at = NULL,
    updated_at = NOW()
  WHERE e.id = p_enrollment_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.restore_enrollment_outbound(UUID, TIMESTAMPTZ) IS
  'Auto Reply outcome: held jobs -> queued (floored to p_resume_at), enrollment position restored from held snapshot. No-op unless active with held_node_id set. Returns TRUE when restored.';

REVOKE ALL ON FUNCTION public.restore_enrollment_outbound(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_enrollment_outbound(UUID, TIMESTAMPTZ) TO service_role;

-- ============================================
-- 6. cancel_held_jobs_for_enrollment
-- ============================================
-- Called at branch time (real category) and from terminal stop paths: a
-- branched or stopped enrollment must never leave restorable holds behind.

CREATE OR REPLACE FUNCTION public.cancel_held_jobs_for_enrollment(
  p_enrollment_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_enrollment_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE message_jobs mj
  SET
    status = 'cancelled',
    status_reason = 'reply_received',
    error_message = 'Reply received; outbound sequence ended by categorizer',
    updated_at = NOW()
  WHERE mj.enrollment_id = p_enrollment_id
    AND mj.status = 'held';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE enrollments e
  SET
    held_node_id = NULL,
    held_next_run_at = NULL,
    updated_at = NOW()
  WHERE e.id = p_enrollment_id
    AND e.held_node_id IS NOT NULL;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.cancel_held_jobs_for_enrollment(UUID) IS
  'Cancels held jobs (status_reason reply_received) and clears the hold snapshot. Used at categorizer branch time and by terminal stop paths.';

REVOKE ALL ON FUNCTION public.cancel_held_jobs_for_enrollment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_held_jobs_for_enrollment(UUID) TO service_role;

-- ============================================
-- 7. wake_enrollment_for_thread_category
-- ============================================
-- Called after a category write (Master Inbox / client API). Wakes the
-- thread's enrollment if it is parked at a categorizer node.

CREATE OR REPLACE FUNCTION public.wake_enrollment_for_thread_category(
  p_thread_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_enrollment_id UUID;
  v_woken INT;
BEGIN
  IF p_thread_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT t.account_id, t.enrollment_id
  INTO v_account_id, v_enrollment_id
  FROM email_threads t
  WHERE t.id = p_thread_id;

  IF v_account_id IS NULL OR v_enrollment_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM account_users au
      WHERE au.user_id = auth.uid()
        AND au.account_id = v_account_id
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  UPDATE enrollments e
  SET
    next_run_at = NOW(),
    updated_at = NOW()
  FROM nodes n
  WHERE e.id = v_enrollment_id
    AND e.state = 'active'
    AND e.deleted_at IS NULL
    AND e.next_run_at IS NULL
    AND n.id = e.current_node_id
    AND n.node_type = 'aiCategorizer';

  GET DIAGNOSTICS v_woken = ROW_COUNT;
  RETURN v_woken > 0;
END;
$$;

COMMENT ON FUNCTION public.wake_enrollment_for_thread_category(UUID) IS
  'Wakes the thread''s enrollment when it is parked (active, next_run_at NULL) at a categorizer node. Authenticated callers must belong to the thread account.';

GRANT EXECUTE ON FUNCTION public.wake_enrollment_for_thread_category(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wake_enrollment_for_thread_category(UUID) TO service_role;

-- ============================================
-- 8. sweep_parked_categorizer_enrollments (safety net)
-- ============================================
-- Wakes parked categorizer enrollments whose latest replied thread is
-- branchable (one of the three categories, any mode) or uncategorized with AI
-- on (a lost park-RPC wake). Auto Reply threads are never woken (prevents a
-- classify/re-park LLM loop) and manual-mode uncategorized threads have
-- nothing to do until a user acts.

CREATE OR REPLACE FUNCTION public.sweep_parked_categorizer_enrollments(
  p_batch_size INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed INTEGER := 0;
  rec RECORD;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 100;
  END IF;
  IF p_batch_size > 500 THEN
    p_batch_size := 500;
  END IF;

  FOR rec IN
    SELECT e.id
    FROM enrollments e
    JOIN nodes n
      ON n.id = e.current_node_id
     AND n.node_type = 'aiCategorizer'
     AND n.deleted_at IS NULL
    CROSS JOIN LATERAL (
      SELECT t.category
      FROM email_threads t
      WHERE t.enrollment_id = e.id
        AND t.has_reply IS TRUE
      ORDER BY t.last_message_at DESC
      LIMIT 1
    ) latest
    WHERE e.state = 'active'
      AND e.next_run_at IS NULL
      AND e.deleted_at IS NULL
      AND e.reply_thread_id IS NULL
      AND (
        latest.category IN ('Interested', 'Neutral', 'Not Interested')
        OR (
          latest.category IS NULL
          AND COALESCE((n.node_data->>'use_ai')::boolean, FALSE) IS TRUE
        )
      )
    ORDER BY e.id
    LIMIT p_batch_size
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    UPDATE enrollments
    SET next_run_at = NOW(), updated_at = NOW()
    WHERE id = rec.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$$;

COMMENT ON FUNCTION public.sweep_parked_categorizer_enrollments(INTEGER) IS
  'Safety net for lost wake events: wakes parked categorizer enrollments with a branchable latest replied thread, or an uncategorized one when AI is on. Skips Auto Reply threads. Intended for scheduler-worker.';

REVOKE ALL ON FUNCTION public.sweep_parked_categorizer_enrollments(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_parked_categorizer_enrollments(INTEGER) TO service_role;

-- ============================================
-- 9. cancel_unsent_campaign_jobs: include held jobs, fix stale 'pending'
-- ============================================

CREATE OR REPLACE FUNCTION cancel_unsent_campaign_jobs(
  p_campaign_id UUID,
  p_reason TEXT DEFAULT 'Campaign paused'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = p_campaign_id
        AND c.account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
    ) THEN
      RETURN 0;
    END IF;
  END IF;

  UPDATE message_jobs mj
  SET
    status = 'cancelled',
    status_reason = 'manually_cancelled',
    error_message = COALESCE(NULLIF(TRIM(p_reason), ''), 'Cancelled'),
    updated_at = NOW()
  WHERE mj.campaign_id = p_campaign_id
    AND mj.status IN ('queued', 'reserved', 'held')
    AND (mj.message_type IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_type IS DISTINCT FROM 'inbox_forward')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_reply')
    AND (mj.message_data->>'source' IS DISTINCT FROM 'inbox_forward');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- A campaign-wide cancel leaves no restorable holds behind.
  UPDATE enrollments e
  SET held_node_id = NULL, held_next_run_at = NULL, updated_at = NOW()
  WHERE e.campaign_id = p_campaign_id
    AND e.held_node_id IS NOT NULL;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION cancel_unsent_campaign_jobs(UUID, TEXT) IS
  'Sets queued/reserved/held campaign message_jobs to cancelled (skips manual inbox jobs) and clears hold snapshots. Authenticated callers must belong to the campaign account.';

-- ============================================
-- 10. get_categorizer_health (self-recovery audit additions)
-- ============================================
-- (1) orphaned holds: held jobs whose enrollment is no longer active.
-- (2) stale parks: parked categorizer enrollments with a branchable latest
--     thread category older than 24h (wake AND sweep both failed).

CREATE OR REPLACE FUNCTION public.get_categorizer_health()
RETURNS TABLE (
  orphaned_held_jobs BIGINT,
  stale_parked_enrollments BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      SELECT COUNT(*)
      FROM message_jobs mj
      LEFT JOIN enrollments e ON e.id = mj.enrollment_id
      WHERE mj.status = 'held'
        AND (
          e.id IS NULL
          OR e.state <> 'active'
          OR e.deleted_at IS NOT NULL
        )
    ) AS orphaned_held_jobs,
    (
      SELECT COUNT(*)
      FROM enrollments e
      JOIN nodes n
        ON n.id = e.current_node_id
       AND n.node_type = 'aiCategorizer'
       AND n.deleted_at IS NULL
      CROSS JOIN LATERAL (
        SELECT t.category, t.updated_at
        FROM email_threads t
        WHERE t.enrollment_id = e.id
          AND t.has_reply IS TRUE
        ORDER BY t.last_message_at DESC
        LIMIT 1
      ) latest
      WHERE e.state = 'active'
        AND e.next_run_at IS NULL
        AND e.deleted_at IS NULL
        AND e.reply_thread_id IS NULL
        AND latest.category IN ('Interested', 'Neutral', 'Not Interested')
        AND latest.updated_at < NOW() - INTERVAL '24 hours'
    ) AS stale_parked_enrollments;
$$;

COMMENT ON FUNCTION public.get_categorizer_health() IS
  'Self-recovery audit: counts of orphaned held jobs (enrollment not active) and parked categorizer enrollments with a branchable category unprocessed for over 24h.';

REVOKE ALL ON FUNCTION public.get_categorizer_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_categorizer_health() TO service_role;

-- ============================================
-- 11. Held-status lifecycle audit fixes
-- ============================================
-- (a) Interval completion must not wait on held jobs: a job can stay held
--     indefinitely (no reply resolution), which would otherwise stall
--     interval progression for the whole campaign. Held counts as
--     completion-terminal; if it is later restored to queued the interval
--     stays completed (sticky), which is harmless - throttles apply at send
--     time, not via interval status.
--     (latest prior body: 20260507202153)

CREATE OR REPLACE FUNCTION public.refresh_campaign_interval_progress_for_ids(
  p_interval_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
  v_interval_id UUID;
BEGIN
  IF p_interval_ids IS NULL OR array_length(p_interval_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  WITH target_intervals AS (
    SELECT DISTINCT interval_id
    FROM unnest(p_interval_ids) AS t(interval_id)
    WHERE interval_id IS NOT NULL
  ),
  interval_job_counts AS (
    SELECT
      mj.interval_id,
      COUNT(*) FILTER (
        WHERE mj.interval_id IS NOT NULL
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      )::INTEGER AS expected_job_count,
      COUNT(DISTINCT mj.mailbox_id) FILTER (
        WHERE mj.interval_id IS NOT NULL
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
      )::INTEGER AS assigned_mailbox_count,
      COUNT(*) FILTER (
        WHERE mj.interval_id IS NOT NULL
          AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
          AND mj.status IN ('sent', 'deferred', 'failed', 'cancelled', 'blocked', 'held')
      )::INTEGER AS terminal_job_count
    FROM message_jobs mj
    INNER JOIN target_intervals ti
      ON ti.interval_id = mj.interval_id
    GROUP BY mj.interval_id
  )
  UPDATE campaign_intervals ci
  SET
    expected_job_count = COALESCE(ijc.expected_job_count, 0),
    assigned_mailbox_count = COALESCE(ijc.assigned_mailbox_count, 0),
    terminal_job_count = COALESCE(ijc.terminal_job_count, 0)
  FROM target_intervals ti
  LEFT JOIN interval_job_counts ijc
    ON ijc.interval_id = ti.interval_id
  WHERE ci.id = ti.interval_id;

  FOR v_interval_id IN
    SELECT DISTINCT interval_id
    FROM unnest(p_interval_ids) AS t(interval_id)
    WHERE interval_id IS NOT NULL
  LOOP
    PERFORM public.complete_campaign_interval_if_ready(v_interval_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- (b) batch_assign_jobs_to_interval dedupe must treat held jobs as existing:
--     without this, a reply that holds a job concurrently with batch
--     assignment could create a duplicate job for the same enrollment+node.
--     (latest prior body: 20260513130000; only the two dedupe status lists changed)

CREATE OR REPLACE FUNCTION batch_assign_jobs_to_interval(
  p_campaign_id UUID,
  p_job_data JSONB[],
  p_worker_id TEXT DEFAULT 'scheduler',
  p_required_mailbox_count INTEGER DEFAULT NULL
)
RETURNS TABLE (
  jobs_created INTEGER,
  interval_id UUID,
  interval_time TIMESTAMPTZ
) AS $$
DECLARE
  v_account_id UUID;
  v_interval_id UUID;
  v_interval_time TIMESTAMPTZ;
  v_interval_duration_seconds INTEGER;
  v_job_count INTEGER := 0;
  v_job_data JSONB;
  v_enrollment_id UUID;
  v_lead_id UUID;
  v_mailbox_id UUID;
  v_node_id UUID;
  v_message_data JSONB;
  v_jitter_percentage NUMERIC;
  v_scheduled_at TIMESTAMPTZ;
  v_jitter_range_seconds NUMERIC;
  v_jitter_offset_seconds NUMERIC;
  v_existing_job_id UUID;
  v_flow_version_number INTEGER;
  v_merged JSONB;
  v_variant_id UUID;
BEGIN
  SELECT c.sending_interval_seconds, c.account_id
  INTO v_interval_duration_seconds, v_account_id
  FROM campaigns c
  WHERE c.id = p_campaign_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND OR v_account_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE campaign_intervals
  SET
    status = 'locked',
    locked_at = NOW(),
    locked_by = p_worker_id,
    updated_at = NOW()
  WHERE campaign_intervals.id = (
    SELECT ci.id
    FROM campaign_intervals ci
    WHERE ci.campaign_id = p_campaign_id
      AND ci.interval_time > NOW()
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_intervals ci_prev
        WHERE ci_prev.campaign_id = ci.campaign_id
          AND ci_prev.interval_time < ci.interval_time
          AND ci_prev.interval_time >= NOW()
          AND ci_prev.status != 'completed'
        ORDER BY ci_prev.interval_time DESC
        LIMIT 1
      )
      AND (ci.status = 'available' OR ci.status = 'scheduled')
    ORDER BY ci.interval_time ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING campaign_intervals.id, campaign_intervals.interval_time
  INTO v_interval_id, v_interval_time;

  IF v_interval_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE campaign_intervals
  SET
    required_mailbox_count = COALESCE(p_required_mailbox_count, required_mailbox_count),
    updated_at = NOW()
  WHERE id = v_interval_id;

  FOREACH v_job_data IN ARRAY COALESCE(p_job_data, ARRAY[]::JSONB[])
  LOOP
    v_enrollment_id := (v_job_data->>'enrollment_id')::UUID;
    v_lead_id := (v_job_data->>'lead_id')::UUID;
    v_mailbox_id := (v_job_data->>'mailbox_id')::UUID;
    v_node_id := (v_job_data->>'node_id')::UUID;
    v_message_data := v_job_data->'message_data';
    v_jitter_percentage := COALESCE((v_job_data->>'jitter_percentage')::NUMERIC, 10.0);

    SELECT e.current_flow_version_number
    INTO v_flow_version_number
    FROM enrollments e
    INNER JOIN leads l
      ON l.id = e.lead_id
     AND l.deleted_at IS NULL
    INNER JOIN mailboxes m
      ON m.id = v_mailbox_id
     AND m.deleted_at IS NULL
    INNER JOIN nodes n
      ON n.id = v_node_id
     AND n.deleted_at IS NULL
    WHERE e.id = v_enrollment_id
      AND e.campaign_id = p_campaign_id
      AND e.lead_id = v_lead_id
      AND e.current_node_id = v_node_id
      AND e.state = 'active'
      AND e.deleted_at IS NULL
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT mj.id INTO v_existing_job_id
    FROM message_jobs mj
    WHERE mj.mailbox_id = v_mailbox_id
      AND mj.interval_id = v_interval_id
      AND mj.status IN ('queued', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked', 'held')
    LIMIT 1
    FOR UPDATE;

    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT mj.id INTO v_existing_job_id
    FROM message_jobs mj
    WHERE mj.enrollment_id = v_enrollment_id
      AND mj.node_id = v_node_id
      AND mj.status IN ('queued', 'reserved', 'sending', 'sent', 'failed', 'cancelled', 'blocked', 'held')
    LIMIT 1
    FOR UPDATE;

    IF v_existing_job_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT m.merged_message_data, m.chosen_variant_id
    INTO v_merged, v_variant_id
    FROM merge_email_variant_into_message_job(
      p_campaign_id,
      v_node_id,
      COALESCE(v_message_data->'lead_data', '{}'::JSONB),
      v_message_data
    ) AS m(merged_message_data, chosen_variant_id);

    v_jitter_range_seconds := v_interval_duration_seconds * (v_jitter_percentage / 100.0);
    v_jitter_offset_seconds := (RANDOM() * 2 - 1) * v_jitter_range_seconds;
    v_scheduled_at := v_interval_time + (v_jitter_offset_seconds || ' seconds')::INTERVAL;

    INSERT INTO message_jobs (
      enrollment_id,
      campaign_id,
      account_id,
      lead_id,
      mailbox_id,
      node_id,
      interval_id,
      scheduled_at,
      status,
      status_reason,
      message_data,
      variant_id,
      flow_version_number,
      message_type
    )
    VALUES (
      v_enrollment_id,
      p_campaign_id,
      v_account_id,
      v_lead_id,
      v_mailbox_id,
      v_node_id,
      v_interval_id,
      v_scheduled_at,
      'queued',
      NULL,
      v_merged,
      v_variant_id,
      v_flow_version_number,
      'campaign'
    );

    v_job_count := v_job_count + 1;
  END LOOP;

  UPDATE campaign_intervals
  SET
    status = CASE
      WHEN v_job_count > 0 OR expected_job_count > 0 THEN 'scheduled'
      ELSE 'available'
    END,
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
  WHERE campaign_intervals.id = v_interval_id;

  PERFORM public.complete_campaign_interval_if_ready(v_interval_id);

  RETURN QUERY
  SELECT
    v_job_count AS jobs_created,
    v_interval_id AS interval_id,
    v_interval_time AS interval_time;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION batch_assign_jobs_to_interval(UUID, JSONB[], TEXT, INTEGER) IS
  'Atomically locks an interval, creates queued campaign message_jobs with variant-aware message_data/variant_id, and updates interval progress counters. Held jobs count as existing in dedupe checks.';
