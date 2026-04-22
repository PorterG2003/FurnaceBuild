-- Scale: avoid giant PostgREST GET URLs for campaign lead filters (scoped id IN lists)
-- and reduce N+1 HTTP round trips when resolving reply categories for large campaigns.

-- Latest replied-thread category per lead (matches app: only Interested / Not Interested
-- count as categorized; otherwise null). One index-friendly scan per campaign.
CREATE OR REPLACE FUNCTION public.latest_reply_category_by_campaign(p_campaign_id uuid)
RETURNS TABLE (
  lead_id uuid,
  reply_category text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (t.lead_id)
    t.lead_id,
    CASE
      WHEN t.category IN ('Interested', 'Not Interested') THEN t.category
      ELSE NULL::text
    END AS reply_category
  FROM public.email_threads t
  WHERE t.campaign_id = p_campaign_id
    AND t.has_reply IS TRUE
    AND t.lead_id IS NOT NULL
  ORDER BY t.lead_id, t.last_message_at DESC;
$$;

COMMENT ON FUNCTION public.latest_reply_category_by_campaign(uuid) IS
  'Returns one row per lead with a replied thread: latest thread by last_message_at; category only Interested/Not Interested else null.';

CREATE INDEX IF NOT EXISTS email_threads_campaign_has_reply_lead_last_at_idx
  ON public.email_threads (campaign_id, lead_id, last_message_at DESC)
  WHERE has_reply IS TRUE AND lead_id IS NOT NULL;

-- Paginated leads for a campaign with filters; scoped ids passed as uuid[] in RPC body (not URL).
CREATE OR REPLACE FUNCTION public.campaign_leads_table_page(
  p_campaign_id uuid,
  p_scoped_ids uuid[],
  p_statuses text[],
  p_search text,
  p_sort text,
  p_asc boolean,
  p_limit int,
  p_offset int
)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  first_name text,
  last_name text,
  company_name text,
  website text,
  linkedin_url text,
  company_linkedin_url text,
  phone_number text,
  source text,
  custom_lead_data jsonb,
  status text,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sort text;
  v_order text;
  v_search text;
  v_pat text;
BEGIN
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id required';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'p_limit out of range';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'p_offset invalid';
  END IF;
  IF p_scoped_ids IS NULL OR COALESCE(array_length(p_scoped_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'p_scoped_ids required';
  END IF;

  v_sort := lower(trim(coalesce(p_sort, 'created_at')));
  IF v_sort NOT IN (
    'email', 'name', 'first_name', 'last_name', 'company_name', 'website',
    'linkedin_url', 'company_linkedin_url', 'phone_number', 'source', 'status', 'created_at'
  ) THEN
    v_sort := 'created_at';
  END IF;

  v_order := CASE WHEN coalesce(p_asc, false) THEN 'ASC NULLS LAST' ELSE 'DESC NULLS FIRST' END;
  v_search := NULLIF(trim(coalesce(p_search, '')), '');
  IF v_search IS NULL THEN
    v_pat := NULL;
  ELSE
    v_pat := '%' || v_search || '%';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT
       l.id,
       l.email,
       l.name,
       l.first_name,
       l.last_name,
       l.company_name,
       l.website,
       l.linkedin_url,
       l.company_linkedin_url,
       l.phone_number,
       l.source,
       l.custom_lead_data,
       l.status::text,
       l.created_at,
       COUNT(*) OVER()::bigint AS total_count
     FROM public.leads l
     WHERE l.campaign_id = $1
       AND l.deleted_at IS NULL
       AND l.id = ANY($2::uuid[])
       AND (
         $3::text[] IS NULL
         OR COALESCE(array_length($3::text[], 1), 0) = 0
         OR l.status::text = ANY($3)
       )
       AND (
         $4::text IS NULL
         OR l.email ILIKE $4
         OR l.name ILIKE $4
         OR l.first_name ILIKE $4
         OR l.last_name ILIKE $4
         OR l.company_name ILIKE $4
         OR l.phone_number ILIKE $4
         OR l.website ILIKE $4
         OR l.linkedin_url ILIKE $4
       )
     ORDER BY l.%I %s
     LIMIT $5 OFFSET $6',
    v_sort,
    v_order
  )
    USING p_campaign_id, p_scoped_ids, p_statuses, v_pat, p_limit, p_offset;
END;
$$;

COMMENT ON FUNCTION public.campaign_leads_table_page(uuid, uuid[], text[], text, text, boolean, int, int) IS
  'Paginated campaign leads with scoped uuid[] in RPC body (avoids URL length limits). Mirrors campaign lead table search/status filters.';

GRANT EXECUTE ON FUNCTION public.latest_reply_category_by_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.latest_reply_category_by_campaign(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.campaign_leads_table_page(uuid, uuid[], text[], text, text, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_leads_table_page(uuid, uuid[], text[], text, text, boolean, int, int) TO service_role;
