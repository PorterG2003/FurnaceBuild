-- Lock down furnace_internal_config: internal trigger config only (not client-readable).

ALTER TABLE public.furnace_internal_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.furnace_internal_config FROM PUBLIC;
REVOKE ALL ON TABLE public.furnace_internal_config FROM anon, authenticated;

COMMENT ON TABLE public.furnace_internal_config IS
  'Environment-specific internal URLs and secrets read by database triggers (e.g. webhook enqueue). RLS enabled with no policies; SECURITY DEFINER triggers and service_role only.';
