-- Flux competitor ad audit: service area on prospects, async jobs, public map bucket

-- ---------------------------------------------------------------------------
-- flux_prospects.service_area (Places-derived center for competitor search)
-- ---------------------------------------------------------------------------
ALTER TABLE public.flux_prospects
  ADD COLUMN IF NOT EXISTS service_area JSONB;

COMMENT ON COLUMN public.flux_prospects.service_area IS
  'Optional { placeId, displayName?, formattedAddress, latitude, longitude, regionCode? } from Google Places for competitor audit area; regionCode is ISO 3166-1 alpha-2 for Google Ads Transparency region.';

-- ---------------------------------------------------------------------------
-- flux_async_jobs (generalized async work; v1: competitor_ad_audit)
-- ---------------------------------------------------------------------------
CREATE TABLE public.flux_async_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  error_message TEXT,
  external_execution_arn TEXT,
  result JSONB,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX flux_async_jobs_idempotency_key_unique
  ON public.flux_async_jobs (idempotency_key);

CREATE UNIQUE INDEX flux_async_jobs_one_active_competitor_audit
  ON public.flux_async_jobs (subject_id, (payload->>'block_id'))
  WHERE job_type = 'competitor_ad_audit'
    AND status IN ('queued', 'running');

CREATE INDEX idx_flux_async_jobs_account_created
  ON public.flux_async_jobs (account_id, created_at DESC);

CREATE INDEX idx_flux_async_jobs_subject
  ON public.flux_async_jobs (subject_type, subject_id);

ALTER TABLE public.flux_async_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flux_async_jobs_select"
  ON public.flux_async_jobs FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_async_jobs_insert"
  ON public.flux_async_jobs FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_async_jobs_update"
  ON public.flux_async_jobs FOR UPDATE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_async_jobs_delete"
  ON public.flux_async_jobs FOR DELETE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

COMMENT ON TABLE public.flux_async_jobs IS
  'Generalized Flux async jobs (e.g. competitor_ad_audit). subject_id meaning depends on subject_type.';

-- ---------------------------------------------------------------------------
-- Storage: map thumbnails for competitor audit (public read)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('flux-competitor-map', 'flux-competitor-map', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "flux_competitor_map_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'flux-competitor-map');
