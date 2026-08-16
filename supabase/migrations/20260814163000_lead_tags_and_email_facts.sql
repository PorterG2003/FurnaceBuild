-- Lead tags (catalog + account-owned), assignments, email verification facts,
-- import metadata helper, and explorer tag filter.

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_tag_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_tag_groups_builtin_key
  ON public.lead_tag_groups (key)
  WHERE account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_tag_groups_account_key
  ON public.lead_tag_groups (account_id, key)
  WHERE account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.lead_tag_groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_tags_catalog_name_lower
  ON public.lead_tags (lower(name))
  WHERE account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_tags_account_name_lower
  ON public.lead_tags (account_id, lower(name))
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_tags_account_id ON public.lead_tags(account_id);
CREATE INDEX IF NOT EXISTS idx_lead_tags_group_id ON public.lead_tags(group_id);

-- ---------------------------------------------------------------------------
-- Assignments (person-keyed; account_id is part of PK because global_lead_id is an email hash)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_tag_assignments (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  global_lead_id TEXT NOT NULL,
  tag_id UUID NOT NULL REFERENCES public.lead_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, global_lead_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_tag_assignments_tag_id ON public.lead_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_lead_tag_assignments_global ON public.lead_tag_assignments(account_id, global_lead_id);

-- ---------------------------------------------------------------------------
-- Email verification facts (independent of account_lead_people rollup)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_email_facts (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  global_lead_id TEXT NOT NULL,
  email TEXT,
  verification_status TEXT
    CHECK (verification_status IS NULL OR verification_status IN ('ok', 'catch_all', 'invalid', 'unknown', 'disposable')),
  verification_quality TEXT,
  verification_provider TEXT,
  verified_at TIMESTAMPTZ,
  is_free BOOLEAN,
  is_role BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, global_lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_email_facts_status
  ON public.lead_email_facts(account_id, verification_status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_tag_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_email_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_tag_groups_select" ON public.lead_tag_groups FOR SELECT TO authenticated
  USING (
    account_id IS NULL
    OR account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );
CREATE POLICY "lead_tag_groups_insert" ON public.lead_tag_groups FOR INSERT TO authenticated
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_tag_groups_update" ON public.lead_tag_groups FOR UPDATE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_tag_groups_delete" ON public.lead_tag_groups FOR DELETE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "lead_tags_select" ON public.lead_tags FOR SELECT TO authenticated
  USING (
    account_id IS NULL
    OR account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid())
  );
CREATE POLICY "lead_tags_insert" ON public.lead_tags FOR INSERT TO authenticated
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_tags_update" ON public.lead_tags FOR UPDATE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_tags_delete" ON public.lead_tags FOR DELETE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "lead_tag_assignments_select" ON public.lead_tag_assignments FOR SELECT TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_tag_assignments_insert" ON public.lead_tag_assignments FOR INSERT TO authenticated
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_tag_assignments_update" ON public.lead_tag_assignments FOR UPDATE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_tag_assignments_delete" ON public.lead_tag_assignments FOR DELETE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "lead_email_facts_select" ON public.lead_email_facts FOR SELECT TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_email_facts_insert" ON public.lead_email_facts FOR INSERT TO authenticated
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_email_facts_update" ON public.lead_email_facts FOR UPDATE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY "lead_email_facts_delete" ON public.lead_email_facts FOR DELETE TO authenticated
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Built-in groups + catalog
-- ---------------------------------------------------------------------------
INSERT INTO public.lead_tag_groups (account_id, key, name)
VALUES
  (NULL, 'provider', 'Provider'),
  (NULL, 'signal', 'Signal'),
  (NULL, 'other', 'Other')
ON CONFLICT DO NOTHING;

INSERT INTO public.lead_tags (account_id, group_id, name, aliases, color)
SELECT NULL, g.id, v.name, v.aliases, v.color
FROM (
  VALUES
    ('provider', 'Apollo', ARRAY['Apollo.io','Apollo Match']::text[], '#F3440D'),
    ('provider', 'Hunter', ARRAY['Hunter.io']::text[], '#818CF8'),
    ('provider', 'Prospeo', ARRAY['Prospeo.io']::text[], '#34D399'),
    ('provider', 'Clay', ARRAY['Clay Table','Clay Waterfall']::text[], '#FBBF24'),
    ('provider', 'Apify', ARRAY['Apify Actor','Scraper Run']::text[], '#F472B6'),
    ('provider', 'Serper', ARRAY['SERP Scrape','Google Search Scrape']::text[], '#60A5FA'),
    ('provider', 'Google Maps', ARRAY['Google Places','GMB','Maps Scrape']::text[], '#A78BFA'),
    ('provider', 'LinkedIn Sales Navigator', ARRAY['Sales Nav','LinkedIn Scrape','Wiza']::text[], '#2DD4BF'),
    ('provider', 'Website Crawl', ARRAY['Site Crawl','Site Intel','LLM Site Read']::text[], '#FB923C'),
    ('provider', 'SkipSherpa', ARRAY['Postal Enrichment','Skip Trace']::text[], '#94A3B8'),
    ('provider', 'Meta Ad Library', ARRAY['Facebook Ad Library','FB Ads Library']::text[], '#F3440D'),
    ('provider', 'LinkedIn Ad Library', ARRAY['LI Ad Library']::text[], '#818CF8'),
    ('provider', 'Google Ads Transparency', ARRAY['Ads Transparency Center','GATC']::text[], '#34D399'),
    ('provider', 'Business Registry', ARRAY['Secretary Of State','SOS Filing','Entity Registry']::text[], '#FBBF24'),
    ('provider', 'License Roster', ARRAY['State Board List','Licensee List','NPI']::text[], '#F472B6'),
    ('provider', 'HubSpot', ARRAY['HubSpot CSV','HS Export']::text[], '#60A5FA'),
    ('provider', 'Salesforce', ARRAY['SFDC','Salesforce Export']::text[], '#A78BFA'),
    ('provider', 'Client CSV', ARRAY['Client List','Customer Upload']::text[], '#2DD4BF'),
    ('provider', 'Webinar Registrant List', ARRAY['Registrant List','Webinar Signups']::text[], '#FB923C'),
    ('provider', 'Demo Request', ARRAY['Inbound Demo','Book A Call']::text[], '#94A3B8'),
    ('provider', 'Content Download', ARRAY['Gated Asset','Lead Magnet','Newsletter Signup']::text[], '#F3440D'),
    ('provider', 'Referral', ARRAY['Partner Referral','Intro']::text[], '#818CF8'),
    ('signal', 'Running Meta Ads', ARRAY['Facebook Ads Active','Meta Advertiser']::text[], '#34D399'),
    ('signal', 'Running Google Ads', ARRAY['Adwords Active','PPC Active']::text[], '#FBBF24'),
    ('signal', 'Running LinkedIn Ads', ARRAY['LI Advertiser']::text[], '#F472B6'),
    ('signal', 'Webinar Or Event Ad', ARRAY['Webinar Advertiser','Masterclass Ad','Workshop Ad']::text[], '#60A5FA'),
    ('signal', 'Qualifying Ad Copy', ARRAY['Ad Phrase Match','Ad Copy Match']::text[], '#A78BFA'),
    ('signal', 'Ads Paused', ARRAY['Ad Stopped','Ad Disposition Off']::text[], '#2DD4BF'),
    ('signal', 'Hiring Intent', ARRAY['Job Post','Actively Hiring','Open Roles']::text[], '#FB923C'),
    ('signal', 'Recently Funded', ARRAY['New Funding','Raised Round']::text[], '#94A3B8'),
    ('signal', 'Tech Match', ARRAY['Stack Fit','Uses Target Tech','Competitor Tech']::text[], '#F3440D'),
    ('signal', 'Regulated Or Licensed', ARRAY['Licensed Professional','Compliance Heavy']::text[], '#818CF8'),
    ('signal', 'Verified Business', ARRAY['Real Company','Site Verified']::text[], '#34D399'),
    ('signal', 'ICP Fit', ARRAY['Title Fit','Persona Match','Function Fit']::text[], '#FBBF24'),
    ('signal', 'Decision Maker', ARRAY['DM','Buyer','Budget Holder']::text[], '#F472B6'),
    ('signal', 'Owner Operator', ARRAY['Owner','Principal','Founder']::text[], '#60A5FA'),
    ('signal', 'Local Business', ARRAY['Home Service','Brick And Mortar']::text[], '#A78BFA'),
    ('signal', 'Engaged', ARRAY['LinkedIn Engaged','Content Engaged','Post Engager']::text[], '#2DD4BF'),
    ('signal', 'Webinar Attendee', ARRAY['Attended','Showed Up']::text[], '#FB923C'),
    ('signal', 'Webinar No Show', ARRAY['Registered Not Attended','No Show']::text[], '#94A3B8'),
    ('other', 'Catch-All Domain', ARRAY['Accept All','Catchall']::text[], '#F3440D'),
    ('other', 'Role Account', ARRAY['Info Address','Generic Inbox','Shared Mailbox']::text[], '#818CF8'),
    ('other', 'Needs Review', ARRAY['Manual Check','Review Queue']::text[], '#34D399'),
    ('other', 'Do Not Send', ARRAY['Suppress','Exclude']::text[], '#FBBF24'),
    ('other', 'Existing Customer', ARRAY['Current Client','Active Account']::text[], '#F472B6'),
    ('other', 'Open Opportunity', ARRAY['In Pipeline','Active Deal']::text[], '#60A5FA'),
    ('other', 'Previously Contacted', ARRAY['Prior Touch','Already Emailed']::text[], '#A78BFA'),
    ('other', 'High Fit', ARRAY['Priority','A List']::text[], '#2DD4BF'),
    ('other', 'Low Fit', ARRAY['C List','Nurture Only']::text[], '#FB923C'),
    ('other', 'EU Contact', ARRAY['Europe','GDPR Region','UK']::text[], '#94A3B8')
) AS v(group_key, name, aliases, color)
INNER JOIN public.lead_tag_groups g ON g.key = v.group_key AND g.account_id IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Resolve tag names (catalog alias or account tag); find-or-create account-owned
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.private_resolve_lead_tag_id(
  p_account_id uuid,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(p_name);
  v_id uuid;
BEGIN
  IF v_name IS NULL OR v_name = '' THEN
    RETURN NULL;
  END IF;

  SELECT t.id INTO v_id
  FROM public.lead_tags t
  WHERE t.account_id IS NULL
    AND (
      lower(t.name) = lower(v_name)
      OR EXISTS (
        SELECT 1 FROM unnest(t.aliases) a WHERE lower(a) = lower(v_name)
      )
    )
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT t.id INTO v_id
  FROM public.lead_tags t
  WHERE t.account_id = p_account_id
    AND (
      lower(t.name) = lower(v_name)
      OR EXISTS (
        SELECT 1 FROM unnest(t.aliases) a WHERE lower(a) = lower(v_name)
      )
    )
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.lead_tags (account_id, name, color)
  VALUES (p_account_id, v_name, NULL)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT t.id INTO v_id
  FROM public.lead_tags t
  WHERE t.account_id = p_account_id AND lower(t.name) = lower(v_name)
  LIMIT 1;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.private_apply_lead_import_metadata(
  p_account_id uuid,
  p_global_lead_id text,
  p_email text,
  p_lead jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag text;
  v_tag_id uuid;
  v_tags jsonb;
  v_ver jsonb;
  v_status text;
BEGIN
  v_tags := p_lead -> 'tags';
  IF jsonb_typeof(v_tags) = 'array' THEN
    FOR v_tag IN SELECT jsonb_array_elements_text(v_tags) LOOP
      v_tag_id := public.private_resolve_lead_tag_id(p_account_id, v_tag);
      IF v_tag_id IS NOT NULL THEN
        INSERT INTO public.lead_tag_assignments (account_id, global_lead_id, tag_id)
        VALUES (p_account_id, p_global_lead_id, v_tag_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(v_tags) = 'string' THEN
    FOREACH v_tag IN ARRAY string_to_array(p_lead ->> 'tags', ',') LOOP
      v_tag_id := public.private_resolve_lead_tag_id(p_account_id, v_tag);
      IF v_tag_id IS NOT NULL THEN
        INSERT INTO public.lead_tag_assignments (account_id, global_lead_id, tag_id)
        VALUES (p_account_id, p_global_lead_id, v_tag_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  v_ver := p_lead -> 'email_verification';
  IF v_ver IS NOT NULL AND jsonb_typeof(v_ver) = 'object' THEN
    v_status := NULLIF(btrim(v_ver ->> 'status'), '');
    IF v_status IS NOT NULL AND v_status NOT IN ('ok', 'catch_all', 'invalid', 'unknown', 'disposable') THEN
      v_status := NULL;
    END IF;
    INSERT INTO public.lead_email_facts (
      account_id, global_lead_id, email,
      verification_status, verification_quality, verification_provider,
      verified_at, is_free, is_role, updated_at
    )
    VALUES (
      p_account_id,
      p_global_lead_id,
      p_email,
      v_status,
      NULLIF(btrim(v_ver ->> 'quality'), ''),
      NULLIF(btrim(v_ver ->> 'provider'), ''),
      CASE
        WHEN NULLIF(btrim(v_ver ->> 'verified_at'), '') IS NULL THEN NULL
        ELSE (v_ver ->> 'verified_at')::timestamptz
      END,
      CASE WHEN v_ver ? 'is_free' THEN (v_ver ->> 'is_free')::boolean ELSE NULL END,
      CASE WHEN v_ver ? 'is_role' THEN (v_ver ->> 'is_role')::boolean ELSE NULL END,
      now()
    )
    ON CONFLICT (account_id, global_lead_id) DO UPDATE SET
      email = EXCLUDED.email,
      verification_status = COALESCE(EXCLUDED.verification_status, public.lead_email_facts.verification_status),
      verification_quality = COALESCE(EXCLUDED.verification_quality, public.lead_email_facts.verification_quality),
      verification_provider = COALESCE(EXCLUDED.verification_provider, public.lead_email_facts.verification_provider),
      verified_at = COALESCE(EXCLUDED.verified_at, public.lead_email_facts.verified_at),
      is_free = COALESCE(EXCLUDED.is_free, public.lead_email_facts.is_free),
      is_role = COALESCE(EXCLUDED.is_role, public.lead_email_facts.is_role),
      updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.private_resolve_lead_tag_id(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.private_apply_lead_import_metadata(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.private_apply_lead_import_metadata(uuid, text, text, jsonb) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_tag_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_tag_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_email_facts TO authenticated;
GRANT ALL ON TABLE public.lead_tag_groups TO service_role;
GRANT ALL ON TABLE public.lead_tags TO service_role;
GRANT ALL ON TABLE public.lead_tag_assignments TO service_role;
GRANT ALL ON TABLE public.lead_email_facts TO service_role;

CREATE OR REPLACE FUNCTION public.private_prevent_catalog_lead_tag_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.account_id IS NULL THEN
    RAISE EXCEPTION 'Built-in catalog lead tags cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS lead_tags_prevent_catalog_delete ON public.lead_tags;
CREATE TRIGGER lead_tags_prevent_catalog_delete
  BEFORE DELETE ON public.lead_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.private_prevent_catalog_lead_tag_delete();
