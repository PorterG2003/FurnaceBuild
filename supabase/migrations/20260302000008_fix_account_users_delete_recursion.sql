-- Fix infinite recursion in account_users INSERT, UPDATE, and DELETE policies.
-- They reference account_users in their checks. Use a SECURITY DEFINER helper
-- so the check does not re-trigger RLS on account_users.

CREATE OR REPLACE FUNCTION get_my_owner_admin_account_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id FROM account_users WHERE user_id = auth.uid() AND role IN ('owner', 'admin');
$$;

DROP POLICY IF EXISTS "account_users_insert_owner_admin" ON account_users;
CREATE POLICY "account_users_insert_owner_admin" ON account_users FOR INSERT
  WITH CHECK (account_id IN (SELECT get_my_owner_admin_account_ids()));

DROP POLICY IF EXISTS "account_users_update_owner_admin" ON account_users;
CREATE POLICY "account_users_update_owner_admin" ON account_users FOR UPDATE
  USING (account_id IN (SELECT get_my_owner_admin_account_ids()));

DROP POLICY IF EXISTS "account_users_delete_owner_admin" ON account_users;
CREATE POLICY "account_users_delete_owner_admin" ON account_users FOR DELETE
  USING (account_id IN (SELECT get_my_owner_admin_account_ids()));
