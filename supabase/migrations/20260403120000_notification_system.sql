-- Notification system: events, preferences, in-app notifications, deliveries, web push subscriptions

-- ---------------------------------------------------------------------------
-- notification_events: immutable domain events (service role + workers write)
-- ---------------------------------------------------------------------------
CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  resource_type text,
  resource_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_events_event_type_check CHECK (
    event_type IN ('email.received')
  )
);

CREATE UNIQUE INDEX notification_events_dedupe_key_unique
  ON notification_events (account_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX notification_events_account_occurred_idx
  ON notification_events (account_id, occurred_at DESC);

COMMENT ON TABLE notification_events IS 'Domain events that may fan out to user notifications; written by workers/service role.';

-- ---------------------------------------------------------------------------
-- notification_preferences: per user + account + event + channel
-- ---------------------------------------------------------------------------
CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'instant',
  quiet_hours jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_event_type_check CHECK (
    event_type IN ('email.received')
  ),
  CONSTRAINT notification_preferences_channel_check CHECK (
    channel IN ('in_app', 'web_push')
  ),
  CONSTRAINT notification_preferences_frequency_check CHECK (
    frequency IN ('instant', 'digest', 'muted')
  ),
  CONSTRAINT notification_preferences_user_account_event_channel_unique UNIQUE (user_id, account_id, event_type, channel)
);

CREATE INDEX notification_preferences_user_account_idx
  ON notification_preferences (user_id, account_id);

-- ---------------------------------------------------------------------------
-- notifications: user-visible in-app notification rows
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'unread',
  read_at timestamptz,
  archived_at timestamptz,
  action_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_status_check CHECK (
    status IN ('unread', 'read', 'archived')
  )
);

CREATE UNIQUE INDEX notifications_event_user_unique ON notifications (event_id, user_id);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, account_id, created_at DESC)
  WHERE read_at IS NULL AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- notification_deliveries: per-channel send attempts (Lambda/service role)
-- ---------------------------------------------------------------------------
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel text NOT NULL,
  provider text NOT NULL DEFAULT 'web_push_vapid',
  status text NOT NULL DEFAULT 'pending',
  attempt_count int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_channel_check CHECK (
    channel IN ('in_app', 'web_push')
  ),
  CONSTRAINT notification_deliveries_status_check CHECK (
    status IN ('pending', 'sending', 'delivered', 'failed', 'skipped')
  )
);

CREATE INDEX notification_deliveries_notification_idx ON notification_deliveries (notification_id);

-- ---------------------------------------------------------------------------
-- push_subscriptions: Web Push endpoints per user (browser/PWA)
-- ---------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_user_unique UNIQUE (user_id, endpoint)
);

CREATE INDEX push_subscriptions_user_account_idx ON push_subscriptions (user_id, account_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
-- No client policies: events are internal; service role bypasses RLS.

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select ON notification_preferences FOR SELECT
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

CREATE POLICY notification_preferences_insert ON notification_preferences FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

CREATE POLICY notification_preferences_update ON notification_preferences FOR UPDATE
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

CREATE POLICY notification_preferences_delete ON notification_preferences FOR DELETE
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

-- No client insert/delete on notifications (service role / Lambda only)

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
-- Deliveries managed by Lambda only (no client policies).

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

CREATE POLICY push_subscriptions_insert ON push_subscriptions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

CREATE POLICY push_subscriptions_update ON push_subscriptions FOR UPDATE
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );
