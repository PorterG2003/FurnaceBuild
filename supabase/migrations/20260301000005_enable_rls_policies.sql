-- ============================================
-- Migration: Enable RLS and create account-scoped policies
-- ============================================
-- All tables (except audit_delete_log) get RLS. Account-scoped tables use
-- account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()).
-- Service role key bypasses RLS (workers/Lambdas).

-- ---------------------------------------------------------------------------
-- users: own row only
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (id = auth.uid());

-- No INSERT from client (trigger creates from auth.users). No DELETE.

-- ---------------------------------------------------------------------------
-- accounts: members can SELECT/UPDATE
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_select_member" ON accounts FOR SELECT
  USING (id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "accounts_update_member" ON accounts FOR UPDATE
  USING (id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

-- INSERT: only via RPC or service role (create account). No DELETE policy (service role only).

-- ---------------------------------------------------------------------------
-- account_users: users see own memberships; owner/admin can insert/delete for their accounts
-- ---------------------------------------------------------------------------
ALTER TABLE account_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_users_select_own" ON account_users FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "account_users_insert_owner_admin" ON account_users FOR INSERT
  WITH CHECK (account_id IN (
    SELECT account_id FROM account_users WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "account_users_update_owner_admin" ON account_users FOR UPDATE
  USING (account_id IN (
    SELECT account_id FROM account_users WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "account_users_delete_owner_admin" ON account_users FOR DELETE
  USING (account_id IN (
    SELECT account_id FROM account_users WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ---------------------------------------------------------------------------
-- Account-scoped tables: same pattern for all
-- campaigns, mailboxes, email_threads, leads, nodes, enrollments, message_jobs,
-- events, campaign_stats, campaign_mailboxes, campaign_intervals, email_messages,
-- thread_tag_assignments, mailbox_throttles, invitations, block_list, thread_tags, high_risk_mailboxes
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'campaigns', 'mailboxes', 'email_threads', 'leads', 'nodes', 'enrollments',
    'message_jobs', 'events', 'campaign_stats', 'campaign_mailboxes', 'campaign_intervals',
    'email_messages', 'thread_tag_assignments', 'mailbox_throttles', 'invitations',
    'block_list', 'thread_tags', 'high_risk_mailboxes'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "account_member_select" ON %I FOR SELECT USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()))',
      t
    );
    EXECUTE format(
      'CREATE POLICY "account_member_insert" ON %I FOR INSERT WITH CHECK (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()))',
      t
    );
    EXECUTE format(
      'CREATE POLICY "account_member_update" ON %I FOR UPDATE USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()))',
      t
    );
    EXECUTE format(
      'CREATE POLICY "account_member_delete" ON %I FOR DELETE USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()))',
      t
    );
  END LOOP;
END;
$$;

-- audit_delete_log: no RLS (admin/internal only, never queried from client)
-- Leave as-is; no ALTER.

COMMENT ON POLICY users_select_own ON users IS 'Users can read only their own row';
COMMENT ON POLICY accounts_select_member ON accounts IS 'Account members can read account';
COMMENT ON POLICY account_users_select_own ON account_users IS 'Users see their own memberships';
