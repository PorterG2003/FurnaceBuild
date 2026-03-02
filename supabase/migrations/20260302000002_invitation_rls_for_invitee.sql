-- Allow authenticated users to SELECT invitations sent to their email address.
-- This lets an invitee view (and then accept) an invitation even though they
-- are not yet a member of the account.
CREATE POLICY "invitations_select_invitee"
  ON invitations FOR SELECT
  USING (
    lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
  );
