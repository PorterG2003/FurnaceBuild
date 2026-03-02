-- Allow users to see other users who share an account with them.
-- Without this, getAccountMembers can fetch account_users rows but not
-- the corresponding users rows, so the team member list is empty.

CREATE POLICY "users_select_account_peers" ON users FOR SELECT
  USING (
    id IN (
      SELECT user_id FROM account_users
      WHERE account_id IN (SELECT get_my_account_ids())
    )
  );
