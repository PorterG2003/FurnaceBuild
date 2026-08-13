-- Per-user preference: permanently skip the mobile web install gate.
-- Clients may UPDATE their own row (users_update_own); used with a localStorage mirror
-- so the gate can bypass before auth/profile loads.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS web_install_gate_dismissed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.users.web_install_gate_dismissed_at IS
  'When set, mobile web skips /install redirect (Always dismiss). Synced with localStorage on the client.';
