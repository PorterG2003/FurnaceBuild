-- The invitations_select_invitee policy references auth.users, but the
-- authenticated role may not have SELECT on auth.users, causing
-- "permission denied for table users". Use a SECURITY DEFINER function
-- so the check runs with definer privileges.

CREATE OR REPLACE FUNCTION get_my_email()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1;
$$;

DROP POLICY IF EXISTS "invitations_select_invitee" ON invitations;

CREATE POLICY "invitations_select_invitee" ON invitations FOR SELECT
  USING (lower(email) = lower(COALESCE(get_my_email(), '')));
