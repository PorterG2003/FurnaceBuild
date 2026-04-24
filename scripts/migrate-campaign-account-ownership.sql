-- =============================================================================
-- Manual migration: move outbound campaigns (and denormalized account_id rows)
-- to destination account.
--
-- Run in Supabase SQL Editor (or psql) with the SERVICE ROLE / postgres role
-- so RLS does not block updates.
--
-- Campaigns:
--   03f27fa3-b8dc-4d0f-be1c-ffd60af72164
--   3376ffca-b6f8-48b6-9ed9-534c206bea88
--   ef85da54-8cd3-43cd-ac40-7e791ba1d069
--
-- Destination account_id:
--   d0bdc238-61b2-49d9-9a49-287456137ffd
--
-- Strategies applied (see plan):
--   - Mailbox: DELETE campaign_mailboxes for these campaigns (reassign in UI
--     from destination-account mailboxes after migration).
--   - Thread tags: DELETE thread_tag_assignments for threads still tied to
--     these campaign_ids (tags pointed at old-account thread_tags).
--   - owner_id: NOT changed here; optional one-liner below after COMMIT.
-- =============================================================================
-- Note: psql users can run \set ON_ERROR_STOP on before this file.
-- Supabase SQL Editor: run the transaction block only (no psql meta-commands).

-- -----------------------------------------------------------------------------
-- PRE-FLIGHT (read-only): run these first; confirm row counts and flux overlap.
-- -----------------------------------------------------------------------------

-- 1) Outbound campaigns must exist
-- SELECT id, name, account_id, owner_id, status, deleted_at
-- FROM public.campaigns
-- WHERE id IN (
--   '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
--   '3376ffca-b6f8-48b6-9ed9-534c206bea88',
--   'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
-- );

-- 2) Same IDs must NOT be flux_campaign primary keys (different product surface)
-- SELECT id, account_id, name FROM public.flux_campaigns
-- WHERE id IN (
--   '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
--   '3376ffca-b6f8-48b6-9ed9-534c206bea88',
--   'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
-- );

-- 3) Mailbox assignments vs mailbox.account_id (expect deletes in migration)
-- SELECT cm.campaign_id, cm.mailbox_id, cm.account_id AS cm_account_id,
--        m.account_id AS mailbox_account_id, m.email_address
-- FROM public.campaign_mailboxes cm
-- JOIN public.mailboxes m ON m.id = cm.mailbox_id
-- WHERE cm.campaign_id IN (
--   '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
--   '3376ffca-b6f8-48b6-9ed9-534c206bea88',
--   'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
-- );

-- 4) Thread / tag counts
-- SELECT COUNT(*) AS threads FROM public.email_threads
-- WHERE campaign_id IN (
--   '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
--   '3376ffca-b6f8-48b6-9ed9-534c206bea88',
--   'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
-- );
-- SELECT COUNT(*) AS tag_assignments_for_those_threads
-- FROM public.thread_tag_assignments tta
-- JOIN public.email_threads et ON et.id = tta.thread_id
-- WHERE et.campaign_id IN (
--   '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
--   '3376ffca-b6f8-48b6-9ed9-534c206bea88',
--   'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
-- );

-- -----------------------------------------------------------------------------
-- MUTATION (single transaction)
-- -----------------------------------------------------------------------------

BEGIN;

  DELETE FROM public.thread_tag_assignments tta
  USING public.email_threads et
  WHERE tta.thread_id = et.id
    AND et.campaign_id IN (
      '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
      '3376ffca-b6f8-48b6-9ed9-534c206bea88',
      'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
    );

  DELETE FROM public.campaign_mailboxes
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.leads
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.nodes
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.enrollments
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.message_jobs
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.events
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.campaign_stats
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.campaign_intervals
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.campaign_flow_versions
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.email_threads
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd'
  WHERE campaign_id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

  UPDATE public.email_messages em
  SET account_id = et.account_id
  FROM public.email_threads et
  WHERE em.thread_id = et.id
    AND et.campaign_id IN (
      '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
      '3376ffca-b6f8-48b6-9ed9-534c206bea88',
      'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
    );

  UPDATE public.campaigns
  SET account_id = 'd0bdc238-61b2-49d9-9a49-287456137ffd',
      updated_at = NOW()
  WHERE id IN (
    '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
    '3376ffca-b6f8-48b6-9ed9-534c206bea88',
    'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
  );

COMMIT;

-- -----------------------------------------------------------------------------
-- OPTIONAL: set owner_id to a user who is a member of the destination account
-- (uncomment and replace <DESTINATION_USER_UUID> with public.users.id)
-- -----------------------------------------------------------------------------
-- UPDATE public.campaigns
-- SET owner_id = '<DESTINATION_USER_UUID>'::uuid,
--     updated_at = NOW()
-- WHERE id IN (
--   '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
--   '3376ffca-b6f8-48b6-9ed9-534c206bea88',
--   'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
-- );

-- -----------------------------------------------------------------------------
-- POST-MIGRATION checks (read-only): every row below should show only
-- account_id = d0bdc238-61b2-49d9-9a49-287456137ffd (or empty if no rows).
-- -----------------------------------------------------------------------------
-- WITH ids AS (
--   SELECT unnest(ARRAY[
--     '03f27fa3-b8dc-4d0f-be1c-ffd60af72164'::uuid,
--     '3376ffca-b6f8-48b6-9ed9-534c206bea88'::uuid,
--     'ef85da54-8cd3-43cd-ac40-7e791ba1d069'::uuid
--   ]) AS campaign_id
-- )
-- SELECT 'campaigns' AS tbl, c.account_id::text, COUNT(*)::bigint
-- FROM public.campaigns c JOIN ids ON c.id = ids.campaign_id GROUP BY c.account_id
-- UNION ALL
-- SELECT 'leads', l.account_id::text, COUNT(*) FROM public.leads l JOIN ids ON l.campaign_id = ids.campaign_id GROUP BY l.account_id
-- UNION ALL
-- SELECT 'nodes', n.account_id::text, COUNT(*) FROM public.nodes n JOIN ids ON n.campaign_id = ids.campaign_id GROUP BY n.account_id
-- UNION ALL
-- SELECT 'enrollments', e.account_id::text, COUNT(*) FROM public.enrollments e JOIN ids ON e.campaign_id = ids.campaign_id GROUP BY e.account_id
-- UNION ALL
-- SELECT 'message_jobs', m.account_id::text, COUNT(*) FROM public.message_jobs m JOIN ids ON m.campaign_id = ids.campaign_id GROUP BY m.account_id
-- UNION ALL
-- SELECT 'events', ev.account_id::text, COUNT(*) FROM public.events ev JOIN ids ON ev.campaign_id = ids.campaign_id GROUP BY ev.account_id
-- UNION ALL
-- SELECT 'campaign_stats', cs.account_id::text, COUNT(*) FROM public.campaign_stats cs JOIN ids ON cs.campaign_id = ids.campaign_id GROUP BY cs.account_id
-- UNION ALL
-- SELECT 'campaign_intervals', ci.account_id::text, COUNT(*) FROM public.campaign_intervals ci JOIN ids ON ci.campaign_id = ids.campaign_id GROUP BY ci.account_id
-- UNION ALL
-- SELECT 'campaign_flow_versions', cfv.account_id::text, COUNT(*) FROM public.campaign_flow_versions cfv JOIN ids ON cfv.campaign_id = ids.campaign_id GROUP BY cfv.account_id
-- UNION ALL
-- SELECT 'email_threads', et.account_id::text, COUNT(*) FROM public.email_threads et JOIN ids ON et.campaign_id = ids.campaign_id GROUP BY et.account_id
-- UNION ALL
-- SELECT 'email_messages', em.account_id::text, COUNT(*)
-- FROM public.email_messages em
-- JOIN public.email_threads et ON et.id = em.thread_id
-- JOIN ids ON et.campaign_id = ids.campaign_id
-- GROUP BY em.account_id
-- ORDER BY tbl;
--
-- SELECT COUNT(*)::bigint AS campaign_mailboxes_remaining
-- FROM public.campaign_mailboxes cm
-- WHERE cm.campaign_id IN (
--   '03f27fa3-b8dc-4d0f-be1c-ffd60af72164',
--   '3376ffca-b6f8-48b6-9ed9-534c206bea88',
--   'ef85da54-8cd3-43cd-ac40-7e791ba1d069'
-- );
--   -- expect 0
--
-- Manual UI (signed in as a destination-account member):
--   - Open each campaign and mission control
--   - Inbox / threads for those campaigns
--   - Re-assign mailboxes (assignments were cleared)
--   - Test send if the campaign is active
