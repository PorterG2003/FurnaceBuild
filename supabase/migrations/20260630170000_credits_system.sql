-- ============================================
-- Migration: generic account credit system
-- ============================================
-- A reusable, feature-agnostic credit primitive keyed by `meter`:
--   - credit_ledger:       append-only signed-delta ledger (audit + metering)
--   - credit_entitlements: per-meter monthly allowance (global default + optional per-account override)
--   - consume_credit / grant_credit / get_credit_balance RPCs (SECURITY DEFINER)
-- Balance for the current period = entitlement grant + sum(delta in period).
-- Period = MST (America/Denver) calendar month; hard monthly reset, no cron.
-- First meter: apollo_enrichment (default 100/month).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meter text NOT NULL,
  delta integer NOT NULL, -- < 0 consume, > 0 grant/refund, 0 audit-only
  reason text,
  ref_type text,
  ref_id text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_ledger_account_meter_created_idx
  ON credit_ledger (account_id, meter, created_at);

COMMENT ON TABLE credit_ledger IS
  'Append-only signed-delta credit ledger. One row per credit event (consume < 0, grant/refund > 0, audit-only = 0). Source of truth for usage metering and audit.';

CREATE TABLE IF NOT EXISTS credit_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meter text NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE, -- NULL = global default
  monthly_grant integer NOT NULL CHECK (monthly_grant >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One global default row per meter, and at most one override per (meter, account).
CREATE UNIQUE INDEX IF NOT EXISTS credit_entitlements_global_unique
  ON credit_entitlements (meter)
  WHERE account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_entitlements_account_unique
  ON credit_entitlements (meter, account_id)
  WHERE account_id IS NOT NULL;

COMMENT ON TABLE credit_entitlements IS
  'Monthly credit allowance per meter. account_id NULL is the global default; a row with account_id overrides it for that account.';

-- Seed the global default allowance for Apollo enrichment.
INSERT INTO credit_entitlements (meter, account_id, monthly_grant)
SELECT 'apollo_enrichment', NULL, 100
WHERE NOT EXISTS (
  SELECT 1 FROM credit_entitlements WHERE meter = 'apollo_enrichment' AND account_id IS NULL
);

-- ---------------------------------------------------------------------------
-- RLS: clients get SELECT only; all writes go through SECURITY DEFINER RPCs / service role.
-- ---------------------------------------------------------------------------
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_ledger_select_member" ON credit_ledger FOR SELECT
  USING (account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid()));

CREATE POLICY "credit_entitlements_select_member" ON credit_entitlements FOR SELECT
  USING (
    account_id IS NULL
    OR account_id IN (SELECT account_id FROM account_users WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Start of the current MST (America/Denver) calendar month, as a timestamptz instant.
CREATE OR REPLACE FUNCTION private_credit_period_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT (date_trunc('month', (now() AT TIME ZONE 'America/Denver')) AT TIME ZONE 'America/Denver');
$$;

-- Resolve the monthly grant for (account, meter): per-account override else global default else 0.
CREATE OR REPLACE FUNCTION private_resolve_monthly_grant(p_account_id uuid, p_meter text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT monthly_grant
    FROM credit_entitlements
    WHERE meter = p_meter
      AND (account_id = p_account_id OR account_id IS NULL)
    ORDER BY account_id NULLS LAST
    LIMIT 1
  ), 0);
$$;

-- ---------------------------------------------------------------------------
-- get_credit_balance: current-period { used, remaining, credit_limit }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_credit_balance(
  p_account_id uuid,
  p_meter text
)
RETURNS TABLE (
  used integer,
  remaining integer,
  credit_limit integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_grant integer;
  v_net integer;
BEGIN
  IF p_account_id IS NULL OR p_meter IS NULL THEN
    RAISE EXCEPTION 'p_account_id and p_meter are required';
  END IF;

  -- Authenticated callers must belong to the account; service role (no JWT) bypasses.
  IF v_uid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM account_users WHERE account_id = p_account_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  v_period_start := private_credit_period_start();
  v_period_end := v_period_start + interval '1 month';
  v_grant := private_resolve_monthly_grant(p_account_id, p_meter);

  SELECT COALESCE(sum(delta), 0)
  INTO v_net
  FROM credit_ledger
  WHERE account_id = p_account_id
    AND meter = p_meter
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  remaining := v_grant + v_net;
  used := v_grant - remaining;
  credit_limit := v_grant;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION get_credit_balance(uuid, text) IS
  'Returns { used, remaining, credit_limit } for the current MST month. Enforces account membership for authenticated callers.';

-- ---------------------------------------------------------------------------
-- consume_credit: atomically charge credits (service role only). Raises
-- INSUFFICIENT_CREDITS when the balance is too low. p_amount = 0 records an
-- audit-only (delta 0) row that never affects the balance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION consume_credit(
  p_account_id uuid,
  p_meter text,
  p_amount integer DEFAULT 1,
  p_reason text DEFAULT NULL,
  p_ref_type text DEFAULT NULL,
  p_ref_id text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS TABLE (
  used integer,
  remaining integer,
  credit_limit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer := COALESCE(p_amount, 1);
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_grant integer;
  v_net integer;
  v_remaining_before integer;
BEGIN
  IF p_account_id IS NULL OR p_meter IS NULL THEN
    RAISE EXCEPTION 'p_account_id and p_meter are required';
  END IF;
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'p_amount must be >= 0 (use grant_credit for refunds)';
  END IF;

  -- Serialize concurrent consumes for the same (account, meter) so the limit can't be exceeded.
  PERFORM pg_advisory_xact_lock(hashtext(p_account_id::text || ':' || p_meter));

  v_period_start := private_credit_period_start();
  v_period_end := v_period_start + interval '1 month';
  v_grant := private_resolve_monthly_grant(p_account_id, p_meter);

  SELECT COALESCE(sum(delta), 0)
  INTO v_net
  FROM credit_ledger
  WHERE account_id = p_account_id
    AND meter = p_meter
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  v_remaining_before := v_grant + v_net;

  IF v_amount > 0 AND v_remaining_before < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO credit_ledger (account_id, meter, delta, reason, ref_type, ref_id, created_by, metadata)
  VALUES (p_account_id, p_meter, -v_amount, p_reason, p_ref_type, p_ref_id, p_created_by, p_metadata);

  remaining := v_remaining_before - v_amount;
  used := v_grant - remaining;
  credit_limit := v_grant;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION consume_credit(uuid, text, integer, text, text, text, uuid, jsonb) IS
  'Atomically consumes p_amount credits for (account, meter) in the current MST month. Raises INSUFFICIENT_CREDITS when the balance is too low. p_amount = 0 writes an audit-only ledger row. Service role only.';

-- ---------------------------------------------------------------------------
-- grant_credit: add credits (refunds, manual bonuses). Service role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_credit(
  p_account_id uuid,
  p_meter text,
  p_amount integer,
  p_reason text DEFAULT NULL,
  p_ref_type text DEFAULT NULL,
  p_ref_id text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS TABLE (
  used integer,
  remaining integer,
  credit_limit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_account_id IS NULL OR p_meter IS NULL THEN
    RAISE EXCEPTION 'p_account_id and p_meter are required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be > 0';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_account_id::text || ':' || p_meter));

  INSERT INTO credit_ledger (account_id, meter, delta, reason, ref_type, ref_id, created_by, metadata)
  VALUES (p_account_id, p_meter, p_amount, p_reason, p_ref_type, p_ref_id, p_created_by, p_metadata);

  RETURN QUERY SELECT * FROM get_credit_balance(p_account_id, p_meter);
END;
$$;

COMMENT ON FUNCTION grant_credit(uuid, text, integer, text, text, text, uuid, jsonb) IS
  'Adds p_amount credits for (account, meter) as a positive ledger row (refunds, manual bonuses). Service role only.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private_credit_period_start() FROM PUBLIC;
REVOKE ALL ON FUNCTION private_resolve_monthly_grant(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_credit_balance(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_credit(uuid, text, integer, text, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION grant_credit(uuid, text, integer, text, text, text, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_credit_balance(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_credit_balance(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION consume_credit(uuid, text, integer, text, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION grant_credit(uuid, text, integer, text, text, text, uuid, jsonb) TO service_role;
