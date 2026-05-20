-- Account owners/admins can read webhook delivery history in the app.
CREATE POLICY webhook_deliveries_select_admin
  ON webhook_deliveries
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );
