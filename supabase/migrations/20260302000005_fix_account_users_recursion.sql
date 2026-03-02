-- Fix infinite recursion in account_users SELECT policy.
-- The previous policy referenced account_users from within its own RLS check.
-- Use a SECURITY DEFINER helper function to break the recursion.

CREATE OR REPLACE FUNCTION get_my_account_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id FROM account_users WHERE user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "account_users_select_members" ON account_users;

CREATE POLICY "account_users_select_members" ON account_users FOR SELECT
  USING (account_id IN (SELECT get_my_account_ids()));
