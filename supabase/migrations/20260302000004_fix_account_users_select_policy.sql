-- Fix account_users SELECT policy: allow members to see ALL members of their
-- accounts, not just their own row. The original policy (user_id = auth.uid())
-- meant team member lists were always empty except for your own entry.
--
-- Uses a SECURITY DEFINER helper to avoid infinite recursion (the policy on
-- account_users cannot directly query account_users).

CREATE OR REPLACE FUNCTION get_my_account_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id FROM account_users WHERE user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "account_users_select_own" ON account_users;

CREATE POLICY "account_users_select_members" ON account_users FOR SELECT
  USING (account_id IN (SELECT get_my_account_ids()));
