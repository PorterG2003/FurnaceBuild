-- Include Neutral in latest replied-thread category per lead (large-campaign RPC path).

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
      WHEN t.category IN ('Interested', 'Neutral', 'Not Interested') THEN t.category
      ELSE NULL::text
    END AS reply_category
  FROM public.email_threads t
  WHERE t.campaign_id = p_campaign_id
    AND t.has_reply IS TRUE
    AND t.lead_id IS NOT NULL
  ORDER BY t.lead_id, t.last_message_at DESC;
$$;

COMMENT ON FUNCTION public.latest_reply_category_by_campaign(uuid) IS
  'Returns one row per lead with a replied thread: latest thread by last_message_at; category only Interested/Neutral/Not Interested else null.';
