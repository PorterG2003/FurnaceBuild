-- Static saved lists for Leads explorer/workbench prototype.
-- This slice keeps saved lists as account-scoped static snapshots of global_lead_id values.

-- Ensure legacy rows have a person identity and keep it in sync on future writes.
UPDATE public.leads
SET global_lead_id = public.generate_global_lead_id(email)
WHERE global_lead_id IS NULL
  AND email IS NOT NULL
  AND btrim(email) <> '';

CREATE OR REPLACE FUNCTION public.sync_leads_global_lead_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.global_lead_id := public.generate_global_lead_id(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_sync_global_lead_id ON public.leads;
CREATE TRIGGER leads_sync_global_lead_id
  BEFORE INSERT OR UPDATE OF email ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_leads_global_lead_id();

CREATE INDEX IF NOT EXISTS idx_leads_account_global_live
  ON public.leads (account_id, global_lead_id)
  WHERE deleted_at IS NULL AND global_lead_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Static saved lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_saved_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_saved_lists_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS public.lead_saved_list_members (
  list_id UUID NOT NULL REFERENCES public.lead_saved_lists(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  global_lead_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'selection',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, global_lead_id),
  CONSTRAINT lead_saved_list_members_source_check CHECK (source IN ('selection', 'csv', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_lead_saved_lists_account_updated_at
  ON public.lead_saved_lists (account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_saved_list_members_account_global
  ON public.lead_saved_list_members (account_id, global_lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_saved_list_members_global_lead_id
  ON public.lead_saved_list_members (global_lead_id);

DROP TRIGGER IF EXISTS update_lead_saved_lists_updated_at ON public.lead_saved_lists;
CREATE TRIGGER update_lead_saved_lists_updated_at
  BEFORE UPDATE ON public.lead_saved_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lead_saved_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_saved_list_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_member_select ON public.lead_saved_lists;
DROP POLICY IF EXISTS account_member_insert ON public.lead_saved_lists;
DROP POLICY IF EXISTS account_member_update ON public.lead_saved_lists;
DROP POLICY IF EXISTS account_member_delete ON public.lead_saved_lists;
CREATE POLICY account_member_select ON public.lead_saved_lists FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY account_member_insert ON public.lead_saved_lists FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY account_member_update ON public.lead_saved_lists FOR UPDATE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY account_member_delete ON public.lead_saved_lists FOR DELETE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS account_member_select ON public.lead_saved_list_members;
DROP POLICY IF EXISTS account_member_insert ON public.lead_saved_list_members;
DROP POLICY IF EXISTS account_member_update ON public.lead_saved_list_members;
DROP POLICY IF EXISTS account_member_delete ON public.lead_saved_list_members;
CREATE POLICY account_member_select ON public.lead_saved_list_members FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY account_member_insert ON public.lead_saved_list_members FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY account_member_update ON public.lead_saved_list_members FOR UPDATE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));
CREATE POLICY account_member_delete ON public.lead_saved_list_members FOR DELETE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

COMMENT ON TABLE public.lead_saved_lists IS
  'Account-scoped static saved lists for the Leads explorer prototype.';
COMMENT ON TABLE public.lead_saved_list_members IS
  'Static members (global_lead_id) for a saved leads list.';

-- ---------------------------------------------------------------------------
-- Account-wide explorer: one row per person/global_lead_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_lead_people_page(
  p_account_id uuid,
  p_global_lead_ids text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_reply_statuses text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_reply_categories text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  global_lead_id text,
  email text,
  display_name text,
  first_name text,
  last_name text,
  campaign_count bigint,
  company_list text,
  has_reply boolean,
  latest_activity timestamptz,
  newest_membership_created_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH normalized_filters AS (
    SELECT
      COALESCE(p_global_lead_ids, ARRAY[]::text[]) AS global_lead_ids,
      COALESCE(p_campaign_ids, ARRAY[]::uuid[]) AS campaign_ids,
      COALESCE(p_reply_statuses, ARRAY[]::text[]) AS reply_statuses,
      COALESCE(p_statuses, ARRAY[]::text[]) AS statuses,
      COALESCE(p_reply_categories, ARRAY[]::text[]) AS reply_categories,
      ARRAY(
        SELECT category
        FROM unnest(COALESCE(p_reply_categories, ARRAY[]::text[])) AS category
        WHERE category <> 'not_categorized'
      ) AS categorized_reply_categories,
      NULLIF(btrim(p_search), '') AS search_query
  ),
  latest_replied_threads AS (
    SELECT DISTINCT ON (t.campaign_id, t.lead_id)
      t.campaign_id,
      t.lead_id,
      CASE
        WHEN t.category IN ('Interested', 'Neutral', 'Not Interested') THEN t.category
        ELSE NULL::text
      END AS reply_category,
      t.has_reply,
      t.last_message_at
    FROM public.email_threads t
    WHERE t.account_id = p_account_id
      AND t.lead_id IS NOT NULL
    ORDER BY t.campaign_id, t.lead_id, t.last_message_at DESC
  ),
  membership_enriched AS (
    SELECT
      l.global_lead_id,
      l.email,
      COALESCE(
        NULLIF(btrim(l.name), ''),
        NULLIF(btrim(concat_ws(' ', l.first_name, l.last_name)), '')
      ) AS display_name,
      l.first_name,
      l.last_name,
      l.campaign_id,
      l.company_name,
      l.status::text AS status,
      l.created_at,
      COALESCE(rt.reply_category, NULL::text) AS reply_category,
      COALESCE(rt.has_reply, false) AS has_reply,
      GREATEST(l.created_at, COALESCE(rt.last_message_at, l.created_at)) AS last_activity_at
    FROM public.leads l
    CROSS JOIN normalized_filters nf
    LEFT JOIN latest_replied_threads rt
      ON rt.lead_id = l.id
     AND rt.campaign_id = l.campaign_id
    WHERE l.account_id = p_account_id
      AND l.deleted_at IS NULL
      AND l.global_lead_id IS NOT NULL
      AND (
        COALESCE(array_length(nf.global_lead_ids, 1), 0) = 0
        OR l.global_lead_id = ANY(nf.global_lead_ids)
      )
  ),
  person_rollups AS (
    SELECT
      me.global_lead_id,
      (ARRAY_REMOVE(ARRAY_AGG(me.email ORDER BY me.created_at DESC), NULL))[1] AS email,
      (ARRAY_REMOVE(ARRAY_AGG(me.display_name ORDER BY me.created_at DESC), NULL))[1] AS display_name,
      (ARRAY_REMOVE(ARRAY_AGG(me.first_name ORDER BY me.created_at DESC), NULL))[1] AS first_name,
      (ARRAY_REMOVE(ARRAY_AGG(me.last_name ORDER BY me.created_at DESC), NULL))[1] AS last_name,
      COUNT(*)::bigint AS campaign_count,
      STRING_AGG(DISTINCT me.company_name, ', ' ORDER BY me.company_name)
        FILTER (WHERE me.company_name IS NOT NULL AND btrim(me.company_name) <> '') AS company_list,
      BOOL_OR(me.has_reply) AS has_reply,
      MAX(me.last_activity_at) AS latest_activity,
      MAX(me.created_at) AS newest_membership_created_at,
      BOOL_OR(COALESCE(array_position((SELECT campaign_ids FROM normalized_filters), me.campaign_id) IS NOT NULL, false)) AS matches_campaign_ids,
      BOOL_OR(COALESCE(array_position((SELECT statuses FROM normalized_filters), me.status) IS NOT NULL, false)) AS matches_statuses,
      BOOL_OR(COALESCE(array_position((SELECT categorized_reply_categories FROM normalized_filters), me.reply_category) IS NOT NULL, false)) AS matches_reply_categories,
      BOOL_OR(me.reply_category IS NULL) AS has_not_categorized,
      lower(
        concat_ws(
          ' ',
          COALESCE((ARRAY_REMOVE(ARRAY_AGG(me.email ORDER BY me.created_at DESC), NULL))[1], ''),
          COALESCE((ARRAY_REMOVE(ARRAY_AGG(me.display_name ORDER BY me.created_at DESC), NULL))[1], ''),
          COALESCE(
            STRING_AGG(DISTINCT me.company_name, ' ' ORDER BY me.company_name)
              FILTER (WHERE me.company_name IS NOT NULL AND btrim(me.company_name) <> ''),
            ''
          )
        )
      ) AS search_text
    FROM membership_enriched me
    GROUP BY me.global_lead_id
  ),
  filtered AS (
    SELECT pr.*
    FROM person_rollups pr
    CROSS JOIN normalized_filters nf
    WHERE (
      COALESCE(array_length(nf.campaign_ids, 1), 0) = 0
      OR pr.matches_campaign_ids
    )
      AND (
        COALESCE(array_length(nf.statuses, 1), 0) = 0
        OR pr.matches_statuses
      )
      AND (
        COALESCE(array_length(nf.reply_categories, 1), 0) = 0
        OR pr.matches_reply_categories
        OR ('not_categorized' = ANY(nf.reply_categories) AND pr.has_not_categorized)
      )
      AND (
        COALESCE(array_length(nf.reply_statuses, 1), 0) = 0
        OR ('has_reply' = ANY(nf.reply_statuses) AND pr.has_reply)
        OR ('no_reply' = ANY(nf.reply_statuses) AND NOT pr.has_reply)
      )
      AND (
        nf.search_query IS NULL
        OR pr.search_text ILIKE '%' || lower(nf.search_query) || '%'
      )
  )
  SELECT
    filtered.global_lead_id,
    filtered.email,
    filtered.display_name,
    filtered.first_name,
    filtered.last_name,
    filtered.campaign_count,
    filtered.company_list,
    filtered.has_reply,
    filtered.latest_activity,
    filtered.newest_membership_created_at,
    COUNT(*) OVER()::bigint AS total_count
  FROM filtered
  ORDER BY filtered.newest_membership_created_at DESC NULLS LAST, filtered.email ASC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer) IS
  'Account-wide one-row-per-person leads explorer with filter support and static global_lead_id scoping.';

GRANT EXECUTE ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_lead_people_page(uuid, text[], uuid[], text[], text[], text[], text, integer, integer) TO service_role;
