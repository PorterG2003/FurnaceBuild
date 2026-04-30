-- Satisfy Supabase linter 0013_rls_disabled_in_public for tables in public schema.
-- audit_delete_log: internal audit trail; no client policies — PostgREST roles see nothing.
--   Inserts run via SECURITY DEFINER triggers / prune; service_role bypasses RLS.
-- campaign_node_variant_state: account-scoped via campaigns (same pattern as other campaign data).

ALTER TABLE audit_delete_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE campaign_node_variant_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_member_select" ON campaign_node_variant_state FOR SELECT
  USING (
    campaign_id IN (
      SELECT c.id
      FROM campaigns c
      WHERE c.account_id IN (
        SELECT account_users.account_id
        FROM account_users
        WHERE account_users.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "account_member_insert" ON campaign_node_variant_state FOR INSERT
  WITH CHECK (
    campaign_id IN (
      SELECT c.id
      FROM campaigns c
      WHERE c.account_id IN (
        SELECT account_users.account_id
        FROM account_users
        WHERE account_users.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "account_member_update" ON campaign_node_variant_state FOR UPDATE
  USING (
    campaign_id IN (
      SELECT c.id
      FROM campaigns c
      WHERE c.account_id IN (
        SELECT account_users.account_id
        FROM account_users
        WHERE account_users.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    campaign_id IN (
      SELECT c.id
      FROM campaigns c
      WHERE c.account_id IN (
        SELECT account_users.account_id
        FROM account_users
        WHERE account_users.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "account_member_delete" ON campaign_node_variant_state FOR DELETE
  USING (
    campaign_id IN (
      SELECT c.id
      FROM campaigns c
      WHERE c.account_id IN (
        SELECT account_users.account_id
        FROM account_users
        WHERE account_users.user_id = auth.uid()
      )
    )
  );

COMMENT ON TABLE audit_delete_log IS 'Logs DELETE operations on key tables for debugging (e.g. inbox wipe). Query by table_name and deleted_at. RLS enabled; no policies — not exposed via PostgREST; use SQL/service_role.';
