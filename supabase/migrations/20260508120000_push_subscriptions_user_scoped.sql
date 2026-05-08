-- Push subscriptions are user-scoped browser devices.
-- Account-level web push enablement remains in notification_preferences.

DROP POLICY push_subscriptions_select ON push_subscriptions;
DROP POLICY push_subscriptions_insert ON push_subscriptions;
DROP POLICY push_subscriptions_update ON push_subscriptions;
DROP POLICY push_subscriptions_delete ON push_subscriptions;

DROP INDEX IF EXISTS push_subscriptions_user_account_idx;

ALTER TABLE push_subscriptions
  DROP COLUMN account_id;

CREATE INDEX push_subscriptions_user_active_idx ON push_subscriptions (user_id)
  WHERE revoked_at IS NULL;

CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY push_subscriptions_insert ON push_subscriptions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_subscriptions_update ON push_subscriptions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (user_id = auth.uid());
