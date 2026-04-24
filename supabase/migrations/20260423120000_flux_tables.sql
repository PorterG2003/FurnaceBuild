-- Flux: personalized prospect landing pages
-- Tables: flux_campaigns, flux_campaign_templates, flux_prospects, flux_prospect_pages

-- ---------------------------------------------------------------------------
-- flux_campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE public.flux_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  offer_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flux_campaigns_account_id ON public.flux_campaigns (account_id);

ALTER TABLE public.flux_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flux_campaigns_select"
  ON public.flux_campaigns FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_campaigns_insert"
  ON public.flux_campaigns FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_campaigns_update"
  ON public.flux_campaigns FOR UPDATE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_campaigns_delete"
  ON public.flux_campaigns FOR DELETE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- flux_campaign_templates (1:1 with campaign via UNIQUE)
-- ---------------------------------------------------------------------------
CREATE TABLE public.flux_campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.flux_campaigns(id) ON DELETE CASCADE,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  copy_slots TEXT[] NOT NULL DEFAULT '{}',
  constraints TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT flux_campaign_templates_campaign_unique UNIQUE (campaign_id)
);

ALTER TABLE public.flux_campaign_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flux_campaign_templates_select"
  ON public.flux_campaign_templates FOR SELECT
  USING (campaign_id IN (
    SELECT c.id FROM public.flux_campaigns c
    INNER JOIN public.account_users au ON au.account_id = c.account_id
    WHERE au.user_id = auth.uid()
  ));

CREATE POLICY "flux_campaign_templates_insert"
  ON public.flux_campaign_templates FOR INSERT
  WITH CHECK (campaign_id IN (
    SELECT c.id FROM public.flux_campaigns c
    INNER JOIN public.account_users au ON au.account_id = c.account_id
    WHERE au.user_id = auth.uid()
  ));

CREATE POLICY "flux_campaign_templates_update"
  ON public.flux_campaign_templates FOR UPDATE
  USING (campaign_id IN (
    SELECT c.id FROM public.flux_campaigns c
    INNER JOIN public.account_users au ON au.account_id = c.account_id
    WHERE au.user_id = auth.uid()
  ));

CREATE POLICY "flux_campaign_templates_delete"
  ON public.flux_campaign_templates FOR DELETE
  USING (campaign_id IN (
    SELECT c.id FROM public.flux_campaigns c
    INNER JOIN public.account_users au ON au.account_id = c.account_id
    WHERE au.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- flux_prospects
-- ---------------------------------------------------------------------------
CREATE TABLE public.flux_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.flux_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  url TEXT,
  industry TEXT,
  company_size TEXT,
  email_notes TEXT,
  brand_profile JSONB,
  logo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flux_prospects_campaign_id ON public.flux_prospects (campaign_id);
CREATE INDEX idx_flux_prospects_account_id ON public.flux_prospects (account_id);

ALTER TABLE public.flux_prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flux_prospects_select"
  ON public.flux_prospects FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_prospects_insert"
  ON public.flux_prospects FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_prospects_update"
  ON public.flux_prospects FOR UPDATE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_prospects_delete"
  ON public.flux_prospects FOR DELETE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- flux_prospect_pages
-- ---------------------------------------------------------------------------
CREATE TABLE public.flux_prospect_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES public.flux_prospects(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.flux_campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  page_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT flux_prospect_pages_slug_unique UNIQUE (slug)
);

CREATE INDEX idx_flux_prospect_pages_campaign_id ON public.flux_prospect_pages (campaign_id);
CREATE INDEX idx_flux_prospect_pages_prospect_id ON public.flux_prospect_pages (prospect_id);

ALTER TABLE public.flux_prospect_pages ENABLE ROW LEVEL SECURITY;

-- Authenticated users: full CRUD scoped to their account
CREATE POLICY "flux_prospect_pages_select"
  ON public.flux_prospect_pages FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_prospect_pages_insert"
  ON public.flux_prospect_pages FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_prospect_pages_update"
  ON public.flux_prospect_pages FOR UPDATE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_prospect_pages_delete"
  ON public.flux_prospect_pages FOR DELETE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

-- Anon: read a single live page by slug (public prospect page rendering)
CREATE POLICY "flux_prospect_pages_anon_select"
  ON public.flux_prospect_pages FOR SELECT
  TO anon
  USING (status = 'live');

-- ---------------------------------------------------------------------------
-- View tracking RPC (security definer to bypass RLS for anon callers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flux_increment_page_view(p_slug TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE flux_prospect_pages
  SET view_count = view_count + 1,
      last_viewed_at = now()
  WHERE slug = p_slug
    AND status = 'live';
END;
$$;

-- Allow anon and authenticated to call the RPC
GRANT EXECUTE ON FUNCTION public.flux_increment_page_view(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flux_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER flux_campaigns_updated_at
  BEFORE UPDATE ON public.flux_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.flux_update_updated_at();

CREATE TRIGGER flux_campaign_templates_updated_at
  BEFORE UPDATE ON public.flux_campaign_templates
  FOR EACH ROW EXECUTE FUNCTION public.flux_update_updated_at();

CREATE TRIGGER flux_prospect_pages_updated_at
  BEFORE UPDATE ON public.flux_prospect_pages
  FOR EACH ROW EXECUTE FUNCTION public.flux_update_updated_at();
